import "server-only";

import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/server/db";
import { BankAccount, Expense, User } from "@/server/models";
import { salaryScope } from "@/server/auth/session";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { addDays, dateRangeFilter, endOfDayIST, startOfDayIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { searchRegex, type ListParams } from "@/lib/list-params";
import type { PaymentMethod } from "@/lib/constants";
import { expenseRowsByIds } from "./queries";
import { PAYING_METHODS } from "./schemas";
import { DUE_EXPR, NOT_FROM_STOCK, PAID_EXPR, statusExpr } from "./payment-status";
import type { PaymentTab } from "./payment-tabs";
import type { ExpenseRow } from "./types";

/**
 * Payment tracking (/finance/payments): expenses by where they stand against what was paid, and
 * every payment recorded one by one. Status follows paymentState (src/lib/payments.ts) through the
 * same expressions the Expenses list filters with, so the counts here match that list.
 */

/** One tab's headline: how many, and the money that matters there (owed, or paid for the Paid tab). */
export type TabTotal = { count: number; total: number };
export type PaymentTabTotals = Record<PaymentTab, TabTotal>;

export type PaymentHistoryRow = {
  /** The payment's id. */
  id: string;
  expenseId: string;
  number: string;
  vendor: string;
  categoryLabel: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  account: string | null;
  reference: string | null;
  note: string | null;
  fromBankStatement: boolean;
  /** The statement line it is matched to, for admins. */
  bankTransactionId: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
};

/**
 * Expenses that can be owed: company expenses (stock counted at purchase is the project's copy of
 * a purchase already listed) that moved or will move money. Members never see salaries.
 */
async function baseMatch(params: Pick<ListParams, "q">): Promise<Record<string, unknown>> {
  const scope = await salaryScope();
  const and: Record<string, unknown>[] = [COMPANY_EXPENSES, NOT_FROM_STOCK, { source: { $nin: ["inventory_assignment", "inventory_wastage"] } }];
  if (Object.keys(scope).length) and.push(scope);
  if (params.q) {
    const re = searchRegex(params.q);
    and.push({ $or: [{ vendor: re }, { number: re }, { description: re }, { "gst.invoiceNumber": re }] });
  }
  return { $and: and };
}

function tabMatch(tab: Exclude<PaymentTab, "history">, now: Date): Record<string, unknown> {
  if (tab === "upcoming") {
    return { _status: { $in: ["unpaid", "partial"] }, _due: { $gte: startOfDayIST(now), $lte: endOfDayIST(addDays(now, 30)) } };
  }
  if (tab === "outstanding") return { _status: { $in: OUTSTANDING_STATUSES } };
  return { _status: tab };
}

/** Everything still owed: the Outstanding tab is these three together. */
const OUTSTANDING_STATUSES = ["unpaid", "partial", "overdue"];

/** A $facet branch that returns nothing ($limit must be positive). */
const NOTHING: PipelineStage.FacetPipelineStage[] = [{ $match: { _id: { $exists: false } } }];

const SORTS: Record<string, string> = { date: "date", amount: "amount", outstanding: "_outstanding", due: "_due", vendor: "vendor" };

export type PaymentTrackingResult = {
  tab: PaymentTab;
  totals: PaymentTabTotals;
  rows: ExpenseRow[];
  history: PaymentHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** Counts and totals of every tab, plus one page of the tab asked for. Expense tabs filter by expense date; history by payment date. */
export async function getPaymentTracking(tab: PaymentTab, params: ListParams, now = new Date()): Promise<PaymentTrackingResult> {
  await connectDB();
  const base = await baseMatch(params);
  const expenseRange = dateRangeFilter(params.from, params.to);
  const match = expenseRange ? { $and: [base, { date: expenseRange }] } : base;

  const withState: PipelineStage[] = [
    { $match: match },
    { $addFields: { _paid: PAID_EXPR, _due: DUE_EXPR, _status: statusExpr(now) } },
    { $addFields: { _outstanding: { $max: [0, { $subtract: ["$amount", "$_paid"] }] } } },
  ];
  const sortField = SORTS[params.sort?.id ?? ""] ?? (tab === "paid" ? "date" : "_due");
  const sortDir = params.sort ? (params.sort.desc ? -1 : 1) : tab === "paid" ? -1 : 1;
  const skip = (params.page - 1) * params.pageSize;

  type Facet = {
    byStatus: { _id: string; n: number; amount: number; outstanding: number }[];
    upcoming: { n: number; outstanding: number }[];
    page: { _id: Types.ObjectId }[];
    count: { n: number }[];
  };
  const [facet] = await Expense.aggregate<Facet>([
    ...withState,
    {
      $facet: {
        byStatus: [{ $group: { _id: "$_status", n: { $sum: 1 }, amount: { $sum: "$amount" }, outstanding: { $sum: "$_outstanding" } } }],
        upcoming: [{ $match: tabMatch("upcoming", now) }, { $group: { _id: null, n: { $sum: 1 }, outstanding: { $sum: "$_outstanding" } } }],
        page:
          tab === "history"
            ? NOTHING
            : [{ $match: tabMatch(tab, now) }, { $sort: { [sortField]: sortDir, _id: -1 } }, { $skip: skip }, { $limit: params.pageSize }, { $project: { _id: 1 } }],
        count: tab === "history" ? NOTHING : [{ $match: tabMatch(tab, now) }, { $count: "n" }],
      },
    },
  ]);

  const status = (s: string) => facet?.byStatus.find((b) => b._id === s);
  const owed = (s: string): TabTotal => ({ count: status(s)?.n ?? 0, total: round2(status(s)?.outstanding ?? 0) });
  const history = await paymentHistory(base, params, tab === "history");
  const totals: PaymentTabTotals = {
    outstanding: {
      count: OUTSTANDING_STATUSES.reduce((n, st) => n + (status(st)?.n ?? 0), 0),
      total: round2(OUTSTANDING_STATUSES.reduce((n, st) => n + (status(st)?.outstanding ?? 0), 0)),
    },
    unpaid: owed("unpaid"),
    partial: owed("partial"),
    overdue: owed("overdue"),
    upcoming: { count: facet?.upcoming[0]?.n ?? 0, total: round2(facet?.upcoming[0]?.outstanding ?? 0) },
    paid: { count: status("paid")?.n ?? 0, total: round2(status("paid")?.amount ?? 0) },
    history: history.totals,
  };
  const rows = tab === "history" ? [] : await expenseRowsByIds((facet?.page ?? []).map((p) => p._id), now);
  return {
    tab,
    totals,
    rows,
    history: history.rows,
    total: tab === "history" ? history.totals.count : (facet?.count[0]?.n ?? 0),
    page: params.page,
    pageSize: params.pageSize,
  };
}

type HistoryDoc = {
  _id: Types.ObjectId;
  number: string;
  vendor: string;
  category: string;
  payment: {
    _id: Types.ObjectId;
    date: Date;
    amount: number;
    paymentMethod: string;
    account?: Types.ObjectId | null;
    reference?: string | null;
    note?: string | null;
    bankTransaction?: Types.ObjectId | null;
    createdBy?: Types.ObjectId | null;
    createdAt?: Date | null;
  };
};

/** Payments recorded one by one (implied payments of older expenses are not listed: they are the expense itself). */
async function paymentHistory(base: Record<string, unknown>, params: ListParams, withRows: boolean): Promise<{ totals: TabTotal; rows: PaymentHistoryRow[] }> {
  const range = dateRangeFilter(params.from, params.to);
  const pipeline: PipelineStage[] = [
    { $match: { $and: [base, { "payments.0": { $exists: true } }] } },
    { $unwind: "$payments" },
    ...(range ? [{ $match: { "payments.date": range } }] : []),
  ];
  const sortDir = params.sort && params.sort.id === "date" && !params.sort.desc ? 1 : -1;
  const sortKey = params.sort?.id === "amount" ? "payment.amount" : "payment.date";
  type Facet = { sum: { n: number; total: number }[]; page: HistoryDoc[] };
  const [facet] = await Expense.aggregate<Facet>([
    ...pipeline,
    { $project: { number: 1, vendor: 1, category: 1, payment: "$payments" } },
    {
      $facet: {
        sum: [{ $group: { _id: null, n: { $sum: 1 }, total: { $sum: "$payment.amount" } } }],
        page: withRows
          ? [{ $sort: { [sortKey]: params.sort?.id === "amount" ? (params.sort.desc ? -1 : 1) : sortDir, "payment._id": -1 } }, { $skip: (params.page - 1) * params.pageSize }, { $limit: params.pageSize }]
          : NOTHING,
      },
    },
  ]);
  const totals = { count: facet?.sum[0]?.n ?? 0, total: round2(facet?.sum[0]?.total ?? 0) };
  const page = facet?.page ?? [];
  if (!page.length) return { totals, rows: [] };

  const accountIds = [...new Set(page.map((d) => d.payment.account).filter(Boolean).map(String))];
  const userIds = [...new Set(page.map((d) => d.payment.createdBy).filter(Boolean).map(String))];
  const [accounts, users, labelOf] = await Promise.all([
    accountIds.length ? BankAccount.find({ _id: { $in: accountIds } }, { name: 1 }).lean() : Promise.resolve([]),
    userIds.length ? User.find({ _id: { $in: userIds } }, { name: 1 }).lean() : Promise.resolve([]),
    getExpenseCategoryLabeler(),
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const userName = new Map(users.map((u) => [String(u._id), u.name ?? ""]));
  const rows = page.map((d) => ({
    id: String(d.payment._id),
    expenseId: String(d._id),
    number: d.number,
    vendor: d.vendor,
    categoryLabel: labelOf(d.category),
    date: d.payment.date.toISOString(),
    amount: d.payment.amount,
    paymentMethod: d.payment.paymentMethod as PaymentMethod,
    account: d.payment.account ? (accountName.get(String(d.payment.account)) ?? null) : null,
    reference: d.payment.reference ?? null,
    note: d.payment.note ?? null,
    fromBankStatement: Boolean(d.payment.bankTransaction),
    bankTransactionId: d.payment.bankTransaction ? String(d.payment.bankTransaction) : null,
    recordedBy: d.payment.createdBy ? (userName.get(String(d.payment.createdBy)) ?? null) : null,
    recordedAt: d.payment.createdAt ? new Date(d.payment.createdAt).toISOString() : null,
  }));
  return { totals, rows };
}

/** What Mark as paid starts with: the method, the account it is paid from, and each method's default account. */
export type PaymentDefaults = {
  paymentMethod: PaymentMethod;
  /** The default account for that method; null when none is set (the ledger then uses the method's default). */
  accountId: string | null;
  /** Method to the open account set as its default (Cash & bank), for when the method is changed. */
  byMethod: Partial<Record<PaymentMethod, string>>;
};

const PAYING = new Set<string>(PAYING_METHODS.map((m) => m.value));

/**
 * Bank transfer from the account set as its default. With none set for bank transfer, the first bank
 * account that is a default for some method, with that method. Otherwise bank transfer with no account.
 */
export async function getPaymentDefaults(): Promise<PaymentDefaults> {
  await connectDB();
  const accounts = await BankAccount.find({ archivedAt: null }, { kind: 1, name: 1, defaultFor: 1 }).sort({ kind: 1, name: 1 }).lean();
  const byMethod: Partial<Record<PaymentMethod, string>> = {};
  for (const a of accounts) {
    for (const m of a.defaultFor ?? []) {
      if (PAYING.has(m) && !byMethod[m as PaymentMethod]) byMethod[m as PaymentMethod] = String(a._id);
    }
  }
  if (byMethod.bank_transfer) return { paymentMethod: "bank_transfer", accountId: byMethod.bank_transfer, byMethod };
  const bank = accounts.find((a) => a.kind === "bank" && (a.defaultFor ?? []).some((m) => PAYING.has(m)));
  const method = bank ? ((bank.defaultFor ?? []).find((m) => PAYING.has(m)) as PaymentMethod | undefined) : undefined;
  if (bank && method) return { paymentMethod: method, accountId: String(bank._id), byMethod };
  return { paymentMethod: "bank_transfer", accountId: null, byMethod };
}
