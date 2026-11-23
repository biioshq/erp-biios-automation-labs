import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { CapitalEntry, EquityHolder, Expense, Income, Invoice, Liability } from "@/server/models";
import { maybeUnpaidFilter, paymentState } from "@/lib/payments";
import { isCurrentLiabilityGroup } from "@/lib/finance-groups";
import { addDays, endOfDayIST, startOfDayIST, toDateInput } from "@/lib/dates";
import { balanceSheet } from "@/server/accounting/statements";
import type { LiabilityStatus, PaymentStatus } from "@/lib/constants";

/**
 * Open items and headline figures shared by the Finance dashboard, the Assets, Liabilities and
 * Equity pages and Analytics: what customers owe, what is owed to suppliers and lenders, and the
 * equity position. Computed from the records on every call; nothing is stored.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Expenses that count in company totals (see metrics.ts COMPANY_EXPENSES). */
const COMPANY = { countedAtPurchase: { $ne: true } } as const;

/* Accounts payable: unpaid and part-paid expenses */

export type PayableRow = {
  id: string;
  number: string;
  vendor: string;
  category: string;
  project: string | null;
  date: string;
  dueDate: string | null;
  amount: number;
  paid: number;
  outstanding: number;
  status: PaymentStatus;
};

/** Every expense with something still to pay, oldest due first. */
export async function openPayables(now: Date = new Date()): Promise<PayableRow[]> {
  await connectDB();
  const docs = await Expense.find(
    { ...COMPANY, ...maybeUnpaidFilter() },
    { number: 1, vendor: 1, category: 1, project: 1, date: 1, dueDate: 1, amount: 1, paymentMethod: 1, payments: 1, account: 1 },
  )
    .sort({ date: 1 })
    .lean();
  const rows: PayableRow[] = [];
  for (const e of docs) {
    const s = paymentState(e, now);
    if (s.outstanding <= 0) continue;
    rows.push({
      id: String(e._id),
      number: e.number,
      vendor: e.vendor,
      category: e.category,
      project: e.project ? String(e.project) : null,
      date: toDateInput(e.date),
      dueDate: s.dueOn ? toDateInput(s.dueOn) : null,
      amount: e.amount,
      paid: s.paid,
      outstanding: s.outstanding,
      status: s.status,
    });
  }
  return rows.sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date));
}

export async function payablesSummary(now: Date = new Date()) {
  const rows = await openPayables(now);
  const soon = toDateInput(addDays(now, 30));
  const today = toDateInput(now);
  const byVendor = new Map<string, { vendor: string; outstanding: number; bills: number; overdue: number }>();
  for (const r of rows) {
    const v = byVendor.get(r.vendor) ?? { vendor: r.vendor, outstanding: 0, bills: 0, overdue: 0 };
    v.outstanding = round2(v.outstanding + r.outstanding);
    v.bills += 1;
    if (r.status === "overdue") v.overdue = round2(v.overdue + r.outstanding);
    byVendor.set(r.vendor, v);
  }
  return {
    total: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
    count: rows.length,
    overdue: round2(rows.filter((r) => r.status === "overdue").reduce((s, r) => s + r.outstanding, 0)),
    overdueCount: rows.filter((r) => r.status === "overdue").length,
    dueSoon: round2(rows.filter((r) => r.status !== "overdue" && r.dueDate && r.dueDate >= today && r.dueDate <= soon).reduce((s, r) => s + r.outstanding, 0)),
    partial: rows.filter((r) => r.status === "partial").length,
    byVendor: [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding),
    rows,
  };
}

/* Accounts receivable: invoices not fully received */

export type ReceivableRow = {
  id: string;
  number: string;
  client: string;
  project: string | null;
  date: string;
  dueDate: string | null;
  total: number;
  received: number;
  outstanding: number;
  status: PaymentStatus;
};

/** Every issued invoice with what was received against it (income records that link it). */
export async function invoiceBalances(now: Date = new Date(), filter: Record<string, unknown> = {}): Promise<ReceivableRow[]> {
  await connectDB();
  const invoices = await Invoice.find({ status: { $ne: "cancelled" }, ...filter }, { number: 1, client: 1, project: 1, date: 1, dueDate: 1, total: 1 })
    .sort({ date: 1 })
    .lean();
  if (!invoices.length) return [];
  const received = await Income.aggregate<{ _id: Types.ObjectId; total: number }>([
    { $match: { invoice: { $in: invoices.map((i) => i._id) } } },
    { $group: { _id: "$invoice", total: { $sum: "$amount" } } },
  ]);
  const got = new Map(received.map((r) => [String(r._id), r.total]));
  const today = startOfDayIST(now).getTime();
  return invoices.map((i) => {
    const r = round2(got.get(String(i._id)) ?? 0);
    const outstanding = round2(Math.max(0, i.total - r));
    const overdue = outstanding > 0 && i.dueDate && i.dueDate.getTime() < today;
    return {
      id: String(i._id),
      number: i.number,
      client: i.client,
      project: i.project ? String(i.project) : null,
      date: toDateInput(i.date),
      dueDate: i.dueDate ? toDateInput(i.dueDate) : null,
      total: i.total,
      received: r,
      outstanding,
      status: (outstanding <= 0 ? "paid" : overdue ? "overdue" : r > 0 ? "partial" : "unpaid") as PaymentStatus,
    };
  });
}

export async function receivablesSummary(now: Date = new Date()) {
  const rows = (await invoiceBalances(now)).filter((r) => r.outstanding > 0);
  const soon = toDateInput(addDays(now, 30));
  const today = toDateInput(now);
  const byClient = new Map<string, { client: string; outstanding: number; invoices: number; overdue: number }>();
  for (const r of rows) {
    const c = byClient.get(r.client) ?? { client: r.client, outstanding: 0, invoices: 0, overdue: 0 };
    c.outstanding = round2(c.outstanding + r.outstanding);
    c.invoices += 1;
    if (r.status === "overdue") c.overdue = round2(c.overdue + r.outstanding);
    byClient.set(r.client, c);
  }
  return {
    total: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
    count: rows.length,
    overdue: round2(rows.filter((r) => r.status === "overdue").reduce((s, r) => s + r.outstanding, 0)),
    overdueCount: rows.filter((r) => r.status === "overdue").length,
    dueSoon: round2(rows.filter((r) => r.status !== "overdue" && r.dueDate && r.dueDate >= today && r.dueDate <= soon).reduce((s, r) => s + r.outstanding, 0)),
    byClient: [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding),
    rows,
  };
}

/* Loans and other liabilities */

export type LiabilityRow = {
  id: string;
  code: string;
  name: string;
  group: string;
  current: boolean;
  lender: string;
  originalAmount: number;
  principalPaid: number;
  interestPaid: number;
  outstanding: number;
  date: string;
  dueDate: string | null;
  interestRate: number | null;
  status: LiabilityStatus;
  lastPaymentDate: string | null;
};

/** Each liability's balance and status, from its repayments. */
export function liabilityState(
  l: { originalAmount: number; dueDate?: Date | null; payments?: { date: Date; principal?: number | null; interest?: number | null }[] | null },
  now: Date = new Date(),
) {
  const payments = l.payments ?? [];
  const principalPaid = round2(payments.reduce((s, p) => s + (p.principal ?? 0), 0));
  const interestPaid = round2(payments.reduce((s, p) => s + (p.interest ?? 0), 0));
  const outstanding = round2(Math.max(0, l.originalAmount - principalPaid));
  const status: LiabilityStatus = outstanding <= 0 ? "paid" : l.dueDate && l.dueDate.getTime() < startOfDayIST(now).getTime() ? "overdue" : "pending";
  const last = payments.reduce<Date | null>((d, p) => (!d || p.date.getTime() > d.getTime() ? p.date : d), null);
  return { principalPaid, interestPaid, outstanding, status, lastPaymentDate: last };
}

export async function liabilityRows(now: Date = new Date(), filter: Record<string, unknown> = {}): Promise<LiabilityRow[]> {
  await connectDB();
  const docs = await Liability.find({ archivedAt: null, ...filter }).sort({ date: -1 }).lean();
  return docs.map((l) => {
    const s = liabilityState(l, now);
    return {
      id: String(l._id),
      code: l.code,
      name: l.name,
      group: l.group,
      current: isCurrentLiabilityGroup(l.group),
      lender: l.lender,
      originalAmount: l.originalAmount,
      principalPaid: s.principalPaid,
      interestPaid: s.interestPaid,
      outstanding: s.outstanding,
      date: toDateInput(l.date),
      dueDate: l.dueDate ? toDateInput(l.dueDate) : null,
      interestRate: l.interestRate ?? null,
      status: s.status,
      lastPaymentDate: s.lastPaymentDate ? toDateInput(s.lastPaymentDate) : null,
    };
  });
}

/**
 * The Liabilities dashboard: totals from the balance sheet (so they match it), plus what is
 * overdue and what falls due in the next 30 days across loans and supplier bills.
 */
export async function liabilitiesOverview(now: Date = new Date()) {
  const [sheet, loans, payables] = await Promise.all([balanceSheet(now), liabilityRows(now), payablesSummary(now)]);
  const soon = toDateInput(addDays(now, 30));
  const today = toDateInput(now);
  const open = loans.filter((l) => l.outstanding > 0);
  const overdueLoans = open.filter((l) => l.status === "overdue");
  const upcomingLoans = open.filter((l) => l.status !== "overdue" && l.dueDate && l.dueDate >= today && l.dueDate <= soon);
  return {
    total: sheet.liabilities.total,
    current: sheet.liabilities.totalCurrent,
    nonCurrent: sheet.liabilities.totalNonCurrent,
    currentLines: sheet.liabilities.current,
    nonCurrentLines: sheet.liabilities.nonCurrent,
    overdue: round2(overdueLoans.reduce((s, l) => s + l.outstanding, 0) + payables.overdue),
    overdueCount: overdueLoans.length + payables.overdueCount,
    upcoming: round2(upcomingLoans.reduce((s, l) => s + l.outstanding, 0) + payables.dueSoon),
    loans: open,
    payables,
  };
}

/* Equity */

/** Capital by holder, drawings, dividends and reserves from the capital entries; retained earnings and total from the balance sheet. */
export async function equityOverview(now: Date = new Date()) {
  await connectDB();
  const asOf = endOfDayIST(now);
  const [sheet, holders, entries] = await Promise.all([
    balanceSheet(now),
    EquityHolder.find({}).sort({ name: 1 }).lean(),
    CapitalEntry.find({ date: { $lte: asOf } }).sort({ date: 1 }).lean(),
  ]);
  const perHolder = new Map<string, { capital: number; initial: number; additional: number; drawings: number; dividends: number; first: Date | null; last: Date | null }>();
  let reserves = 0;
  let dividends = 0;
  for (const e of entries) {
    if (e.type === "reserve_transfer") reserves += e.amount;
    if (e.type === "dividend") dividends += e.amount;
    if (!e.holder) continue;
    const key = String(e.holder);
    const h = perHolder.get(key) ?? { capital: 0, initial: 0, additional: 0, drawings: 0, dividends: 0, first: null, last: null };
    if (e.type === "capital") {
      h.capital += e.amount;
      if (e.initial) h.initial += e.amount;
      else h.additional += e.amount;
      h.first = h.first ?? e.date;
      h.last = e.date;
    } else if (e.type === "drawing") h.drawings += e.amount;
    else if (e.type === "dividend") h.dividends += e.amount;
    perHolder.set(key, h);
  }
  const line = (key: string) => sheet.equity.lines.find((l) => l.key === key)?.amount ?? 0;
  const rows = holders.map((h) => {
    const t = perHolder.get(String(h._id)) ?? { capital: 0, initial: 0, additional: 0, drawings: 0, dividends: 0, first: null, last: null };
    return {
      id: String(h._id),
      name: h.name,
      kind: h.kind,
      ownershipPercent: h.ownershipPercent ?? null,
      archived: Boolean(h.archivedAt),
      capital: round2(t.capital),
      initial: round2(t.initial),
      additional: round2(t.additional),
      drawings: round2(t.drawings),
      dividends: round2(t.dividends),
      net: round2(t.capital - t.drawings),
      firstContribution: t.first ? toDateInput(t.first) : null,
      lastContribution: t.last ? toDateInput(t.last) : null,
    };
  });
  return {
    asOf: sheet.asOf,
    ownersCapital: line("owners_capital"),
    investorsCapital: line("investors_capital"),
    drawings: line("drawings"),
    reserves: line("reserves_surplus"),
    retainedEarnings: line("retained_earnings"),
    retainedLine: sheet.equity.lines.find((l) => l.key === "retained_earnings") ?? null,
    openingBalance: line("opening_balance"),
    reservesTransferred: round2(reserves),
    dividends: round2(dividends),
    total: sheet.equity.total,
    lines: sheet.equity.lines,
    holders: rows,
  };
}
