import "server-only";

import { can, getCurrentUser, salaryScope } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { AccountTransfer, Expense, Income } from "@/server/models";
import { getExpenseCategories } from "@/server/expense-categories";
import { ledgerAsOf } from "@/server/accounting/ledger";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { expenseFilter } from "@/features/finance/expenses/queries";
import { NOT_FROM_STOCK } from "@/features/finance/expenses/payment-status";
import { projectMatch } from "@/features/reports/server/common";
import { effectivePayments, maybeUnpaidFilter, paymentState, type ExpenseLike, type PaymentLike } from "@/lib/payments";
import { INCOME_CATEGORIES, PAYMENT_METHODS, labelOf, type IncomeCategory, type PaymentMethod } from "@/lib/constants";
import { expenseCategoryLabel } from "@/lib/expense-categories";
import { dateRangeFilter, endOfDayIST, fromDateInput, toDateInput } from "@/lib/dates";
import { TIME_ZONE, round2 } from "@/lib/format";
import {
  daysBetween,
  dailyRange,
  type CustomerRow,
  type DailyDay,
  type DailyFilters,
  type DailyOverview,
  type TransactionRow,
  type VendorRow,
} from "./types";

/**
 * The Daily overview: one IST day or a range of days, from the same records the rest of finance
 * reads. Each figure says what it counts:
 *  - Income received: income records by their date, except older ones saved "On credit" (counted apart).
 *  - Expenses incurred: company expenses by expense date (billed, whether or not paid), as the Expenses
 *    list and the Expense summary count them.
 *  - Payments made: payments by payment date. An explicit payment counts on its own date; an expense with
 *    no payments list and not on credit counts as paid in full on its expense date (src/lib/payments.ts).
 *    Generated stock rows are left out, as on the Payment tracking page.
 *  - Outstanding: what vendors are still owed at the end of the day, counting only payments dated up to it.
 *  - Net cash flow: from the books (all bank and cash accounts, internal transfers left out) for the whole
 *    company, or income received minus payments made from the records when the books are not shown.
 * Salary rows follow the viewer's salary access in every figure. Vendor and category narrow the expense
 * side only; project narrows income too.
 */

const TRANSACTION_LIMIT = 200;
const VENDOR_LIMIT = 100;
const CUSTOMER_LIMIT = 100;
const GENERATED = ["inventory_assignment", "inventory_wastage"];

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const dayOf = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: field, timezone: TIME_ZONE } });

type ExpenseRow = {
  _id: unknown;
  number: string;
  vendor: string;
  category: string;
  amount: number;
  date: Date;
  dueDate?: Date | null;
  paymentMethod: string;
  account?: unknown;
  payments?: (PaymentLike & { _id?: unknown })[] | null;
  project?: { name?: string } | null;
};

export type DailyInput = {
  from: string | null;
  to: string | null;
  filters?: Partial<DailyFilters>;
  /** Rows of the transactions list (the page shows the latest 200; a file takes them all). */
  transactionLimit?: number;
  /** Rows of the vendor-wise and customer-wise tables (the page shows the largest 100; a file takes them all). */
  partyLimit?: number;
};

export async function getDailyOverview(input: DailyInput, now: Date = new Date()): Promise<DailyOverview> {
  await connectDB();
  const today = toDateInput(now);
  const { from, to, clamped } = dailyRange(input.from, input.to, today);
  const filters: DailyFilters = { project: input.filters?.project ?? [], vendor: input.filters?.vendor ?? [], category: input.filters?.category ?? [] };
  const filtered = Boolean(filters.project.length || filters.vendor.length || filters.category.length);
  const expenseSideFiltered = Boolean(filters.vendor.length || filters.category.length);
  const days = daysBetween(from, to);
  const start = fromDateInput(from);
  const end = endOfDayIST(fromDateInput(to));
  const range = dateRangeFilter(from, to)!;
  const limit = input.transactionLimit ?? TRANSACTION_LIMIT;
  const vendorLimit = input.partyLimit ?? VENDOR_LIMIT;
  const customerLimit = input.partyLimit ?? CUSTOMER_LIMIT;

  const user = await getCurrentUser();
  const seesPosition = Boolean(user && can(user, "data.financial_position"));
  const [scope, categories] = await Promise.all([salaryScope(), getExpenseCategories()]);
  const salariesHidden = Object.keys(scope).length > 0;

  // Vendor, category and project narrow the expense side (the same conditions as the Expenses list).
  const base = expenseFilter({ q: "", filters: { vendor: filters.vendor, category: filters.category, project: filters.project }, from: null, to: null });
  const withScope = (...extra: Record<string, unknown>[]) => ({ $and: [base, ...extra, ...(salariesHidden ? [scope] : [])] }) as never;

  /* Expenses incurred: by expense date, as the Expenses list totals them. */
  const incurredMatch = withScope(COMPANY_EXPENSES, { date: range });
  const [incurredFacet] = await Expense.aggregate<{
    byDay: { _id: string; total: number; count: number }[];
    byVendor: { _id: string; total: number }[];
  }>([
    { $match: incurredMatch },
    {
      $facet: {
        byDay: [{ $group: { _id: dayOf("$date"), total: { $sum: "$amount" }, count: { $sum: 1 } } }],
        byVendor: [{ $group: { _id: "$vendor", total: { $sum: "$amount" } } }],
      },
    },
  ]);

  /* Payments made: explicit payments on their date, implied full payments on the expense date. */
  const paymentCandidates = (await Expense.find(
    withScope(COMPANY_EXPENSES, NOT_FROM_STOCK, { source: { $nin: GENERATED } }, {
      $or: [{ "payments.date": range }, { payments: { $not: { $type: "array" } }, paymentMethod: { $ne: "credit" }, date: range }],
    }),
    { number: 1, vendor: 1, category: 1, amount: 1, date: 1, paymentMethod: 1, account: 1, payments: 1 },
  ).lean()) as unknown as ExpenseRow[];
  type PaidRow = { expenseId: string; number: string; vendor: string; category: string; day: string; amount: number; method: string; reference: string | null; index: number };
  const paid: PaidRow[] = [];
  for (const e of paymentCandidates) {
    effectivePayments(e as unknown as ExpenseLike).forEach((p, index) => {
      const day = toDateInput(p.date);
      if (day < from || day > to) return;
      const amount = Number(p.amount) || 0;
      if (amount <= 0) return;
      paid.push({ expenseId: String(e._id), number: e.number, vendor: e.vendor, category: e.category, day, amount, method: p.paymentMethod, reference: p.reference ?? null, index });
    });
  }

  /* Outstanding: owed at the end of each day, counting only payments dated up to it. */
  const openCandidates = (await Expense.find(
    withScope(COMPANY_EXPENSES, NOT_FROM_STOCK, { source: { $nin: GENERATED } }, { date: { $lte: end } }, maybeUnpaidFilter()),
    { number: 1, vendor: 1, amount: 1, date: 1, dueDate: 1, paymentMethod: 1, account: 1, payments: 1 },
  ).lean()) as unknown as ExpenseRow[];
  const outstandingByDay = new Map<string, { total: number; overdue: number }>(days.map((d) => [d, { total: 0, overdue: 0 }]));
  const owedByVendor = new Map<string, number>();
  let outstandingCount = 0;
  let overdueCount = 0;
  for (const e of openCandidates) {
    const all = effectivePayments(e as unknown as ExpenseLike).map((p) => ({ ...p, t: new Date(p.date).getTime() }));
    const billedDay = toDateInput(e.date);
    const first = Math.max(0, days.findIndex((d) => d >= billedDay));
    for (let i = first; i < days.length; i++) {
      const asOf = endOfDayIST(fromDateInput(days[i]));
      const state = paymentState(
        { amount: e.amount, date: e.date, dueDate: e.dueDate, paymentMethod: e.paymentMethod, payments: all.filter((p) => p.t <= asOf.getTime()) },
        asOf,
      );
      // Payments only reduce what is owed, so once it is settled the rest of the range is too.
      if (state.outstanding <= 0) break;
      const slot = outstandingByDay.get(days[i])!;
      slot.total += state.outstanding;
      if (state.status === "overdue") slot.overdue += state.outstanding;
      if (i === days.length - 1) {
        outstandingCount += 1;
        if (state.status === "overdue") overdueCount += 1;
        const key = nameKey(e.vendor);
        owedByVendor.set(key, (owedByVendor.get(key) ?? 0) + state.outstanding);
      }
    }
  }

  /* Income received by day and customer; "On credit" records are counted apart. */
  const incomeProject = projectMatch(filters.project);
  const incomeBase = { date: range, ...(incomeProject ? { project: incomeProject } : {}) };
  const [incomeFacet] = await Income.aggregate<{
    byDay: { _id: string; total: number; count: number }[];
    byClient: { _id: string; total: number; count: number }[];
    credit: { _id: null; total: number; count: number }[];
  }>([
    { $match: incomeBase },
    {
      $facet: {
        byDay: [{ $match: { paymentMethod: { $ne: "credit" } } }, { $group: { _id: dayOf("$date"), total: { $sum: "$amount" }, count: { $sum: 1 } } }],
        byClient: [{ $match: { paymentMethod: { $ne: "credit" } } }, { $group: { _id: "$client", total: { $sum: "$amount" }, count: { $sum: 1 } } }],
        credit: [{ $match: { paymentMethod: "credit" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }],
      },
    },
  ]);

  /* Cash and bank movement from the books, bucketed once by IST day. Whole company, so only without filters. */
  const cashByDay = new Map<string, { in: number; out: number }>();
  let book: Awaited<ReturnType<typeof ledgerAsOf>>["book"] | null = null;
  const ledgerNet = seesPosition && !filtered;
  if (ledgerNet) {
    const ledger = await ledgerAsOf(end);
    book = ledger.book;
    for (const p of ledger.postings) {
      if (p.date.getTime() < start.getTime() || p.date.getTime() > end.getTime()) continue;
      if (!ledger.accounts.get(p.account)?.cash) continue;
      // Transfers between own accounts and opening balances are not cash flow (as in cashFlow()).
      if ((p.cf?.activity ?? "operating") === "internal") continue;
      const slot = cashByDay.get(toDateInput(p.date)) ?? { in: 0, out: 0 };
      if (p.amount >= 0) slot.in += p.amount;
      else slot.out -= p.amount;
      cashByDay.set(toDateInput(p.date), slot);
    }
  }

  /* Per-day rows. */
  const incurredByDay = new Map((incurredFacet?.byDay ?? []).map((r) => [r._id, r]));
  const incomeByDay = new Map((incomeFacet?.byDay ?? []).map((r) => [r._id, r]));
  const paidByDay = new Map<string, { total: number; count: number }>();
  for (const p of paid) {
    const slot = paidByDay.get(p.day) ?? { total: 0, count: 0 };
    slot.total += p.amount;
    slot.count += 1;
    paidByDay.set(p.day, slot);
  }
  const rows: DailyDay[] = days.map((day) => {
    const cash = cashByDay.get(day);
    const open = outstandingByDay.get(day)!;
    return {
      day,
      income: round2(incomeByDay.get(day)?.total ?? 0),
      incomeCount: incomeByDay.get(day)?.count ?? 0,
      expenses: round2(incurredByDay.get(day)?.total ?? 0),
      expenseCount: incurredByDay.get(day)?.count ?? 0,
      payments: round2(paidByDay.get(day)?.total ?? 0),
      paymentCount: paidByDay.get(day)?.count ?? 0,
      outstanding: round2(open.total),
      overdue: round2(open.overdue),
      cashIn: ledgerNet ? round2(cash?.in ?? 0) : null,
      cashOut: ledgerNet ? round2(cash?.out ?? 0) : null,
      netCash: ledgerNet ? round2((cash?.in ?? 0) - (cash?.out ?? 0)) : null,
    };
  });
  const sum = (pick: (d: DailyDay) => number) => round2(rows.reduce((s, d) => s + pick(d), 0));
  const last = rows[rows.length - 1];
  const totals: DailyOverview["totals"] = {
    income: sum((d) => d.income),
    incomeCount: rows.reduce((s, d) => s + d.incomeCount, 0),
    onCredit: { count: incomeFacet?.credit[0]?.count ?? 0, total: round2(incomeFacet?.credit[0]?.total ?? 0) },
    expenses: sum((d) => d.expenses),
    expenseCount: rows.reduce((s, d) => s + d.expenseCount, 0),
    payments: sum((d) => d.payments),
    paymentCount: rows.reduce((s, d) => s + d.paymentCount, 0),
    outstanding: last?.outstanding ?? 0,
    outstandingCount,
    overdue: last?.overdue ?? 0,
    overdueCount,
  };
  const net: DailyOverview["net"] = ledgerNet
    ? { basis: "ledger", value: sum((d) => d.netCash ?? 0), cashIn: sum((d) => d.cashIn ?? 0), cashOut: sum((d) => d.cashOut ?? 0) }
    : expenseSideFiltered
      ? null
      : { basis: "records", value: round2(totals.income - totals.payments), cashIn: null, cashOut: null };

  /* Vendor-wise: billed in the range, paid in the range, and owed at its end. */
  const vendorMap = new Map<string, VendorRow>();
  const vendorRow = (name: string): VendorRow => {
    const key = nameKey(name);
    let v = vendorMap.get(key);
    if (!v) {
      v = { key, vendor: name.trim().replace(/\s+/g, " "), incurred: 0, paid: 0, owed: 0 };
      vendorMap.set(key, v);
    }
    return v;
  };
  for (const r of incurredFacet?.byVendor ?? []) vendorRow(r._id ?? "").incurred += r.total;
  for (const p of paid) vendorRow(p.vendor).paid += p.amount;
  for (const [key, owed] of owedByVendor) {
    const existing = vendorMap.get(key);
    if (existing) existing.owed += owed;
    else {
      const name = openCandidates.find((e) => nameKey(e.vendor) === key)?.vendor ?? key;
      vendorRow(name).owed += owed;
    }
  }
  const vendorsAll = [...vendorMap.values()]
    .map((v) => ({ ...v, incurred: round2(v.incurred), paid: round2(v.paid), owed: round2(v.owed) }))
    .sort((a, b) => b.incurred + b.paid + b.owed - (a.incurred + a.paid + a.owed) || a.vendor.localeCompare(b.vendor));

  /* Customer-wise receipts. */
  const customerMap = new Map<string, CustomerRow>();
  for (const r of incomeFacet?.byClient ?? []) {
    const key = nameKey(r._id ?? "");
    const c = customerMap.get(key) ?? { key, client: (r._id ?? "").trim().replace(/\s+/g, " "), received: 0, count: 0 };
    c.received += r.total;
    c.count += r.count;
    customerMap.set(key, c);
  }
  const customersAll = [...customerMap.values()].map((c) => ({ ...c, received: round2(c.received) })).sort((a, b) => b.received - a.received || a.client.localeCompare(b.client));

  /* The day's transactions: expenses billed, payments made, receipts and transfers. */
  const [expenseDocs, incomeDocs, transferDocs] = await Promise.all([
    Expense.find(incurredMatch, { number: 1, vendor: 1, category: 1, amount: 1, date: 1, project: 1 })
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .populate("project", "name")
      .lean() as unknown as Promise<ExpenseRow[]>,
    Income.find({ ...incomeBase, paymentMethod: { $ne: "credit" } }, { number: 1, client: 1, category: 1, amount: 1, date: 1, paymentMethod: 1, project: 1 })
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .populate("project", "name")
      .lean(),
    ledgerNet ? AccountTransfer.find({ date: range }).sort({ date: -1, _id: -1 }).limit(limit).lean() : Promise.resolve([]),
  ]);
  const transactions: TransactionRow[] = [];
  for (const e of expenseDocs) {
    transactions.push({
      key: `e:${e._id}`,
      kind: "expense",
      day: toDateInput(e.date),
      party: e.vendor,
      title: e.number,
      detail: [expenseCategoryLabel(categories, e.category), e.project?.name].filter(Boolean).join(" · "),
      amount: e.amount,
      href: `/finance/expenses?view=${e._id}`,
    });
  }
  for (const p of paid) {
    transactions.push({
      key: `p:${p.expenseId}:${p.index}`,
      kind: "payment",
      day: p.day,
      party: p.vendor,
      title: p.number,
      detail: [labelOf(PAYMENT_METHODS, p.method as PaymentMethod), p.reference].filter(Boolean).join(" · "),
      amount: p.amount,
      href: `/finance/expenses?view=${p.expenseId}`,
    });
  }
  for (const i of incomeDocs) {
    const project = (i.project as unknown as { name?: string } | null)?.name;
    transactions.push({
      key: `i:${i._id}`,
      kind: "receipt",
      day: toDateInput(i.date),
      party: i.client,
      title: i.number,
      detail: [labelOf(INCOME_CATEGORIES, i.category as IncomeCategory), project].filter(Boolean).join(" · "),
      amount: i.amount,
      href: `/finance/income?view=${i._id}`,
    });
  }
  for (const t of transferDocs) {
    const name = (id: unknown) => book?.byCode.get(`cash:${id}`)?.name ?? "Account";
    transactions.push({
      key: `t:${t._id}`,
      kind: "transfer",
      day: toDateInput(t.date),
      party: `${name(t.from)} to ${name(t.to)}`,
      title: "Transfer",
      detail: t.reference ?? "Between own accounts, not income or expense",
      amount: t.amount,
      href: "/finance/assets/cash",
    });
  }
  const order = { expense: 0, payment: 1, receipt: 2, transfer: 3 } as const;
  transactions.sort((a, b) => b.day.localeCompare(a.day) || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
  const transactionTotal = totals.expenseCount + totals.paymentCount + totals.incomeCount + transferDocs.length;

  return {
    from,
    to,
    clamped,
    single: from === to,
    filters,
    filtered,
    days: rows,
    totals,
    net,
    vendors: vendorsAll.slice(0, vendorLimit),
    vendorCount: vendorsAll.length,
    customers: customersAll.slice(0, customerLimit),
    customerCount: customersAll.length,
    transactions: transactions.slice(0, limit),
    transactionTotal,
    salariesHidden,
    seesPosition,
  };
}
