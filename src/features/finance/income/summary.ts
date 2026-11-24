import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Income, Invoice, Project } from "@/server/models";
import { invoiceBalances } from "@/server/finance/summaries";
import { dateRangeFilter, financialYearIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { IncomeCategory } from "@/lib/constants";

/**
 * The income summary: cash received (income records, except older ones saved "On credit") and invoiced (issued invoices, with GST),
 * by day, month, financial year, project and customer, plus what customers still owe. The two
 * are never added together: a receipt linked to an invoice is the payment of that invoice.
 */

const TZ = "Asia/Kolkata";

/** Days with receipts listed on the summary (newest first); the table shows 10 and the Rows box shows more. */
export const DAY_LIMIT = 400;
/** Open invoices listed on the summary, due first. */
const OPEN_INVOICE_LIMIT = 200;

export type SummaryRange = { from: string; to: string };

/** The range from the URL, or the current financial year up to today. */
export function summaryRange(from: string | null, to: string | null, now: Date = new Date()): SummaryRange {
  const fy = financialYearIST(now);
  const f = from ?? toDateInput(fy.start);
  const t = to ?? toDateInput(now);
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

export type MonthPoint = { month: string; received: number; invoiced: number };
export type DayRow = { day: string; received: number; count: number };
export type YearRow = { label: string; start: string; received: number; invoiced: number };
export type PartyRow = { key: string; name: string; href: string | null; received: number; invoiced: number; outstanding: number; overdue: number };
export type CategoryRow = { category: IncomeCategory; received: number; count: number };
export type OpenInvoiceRow = { id: string; number: string; client: string; dueDate: string | null; date: string; outstanding: number; overdue: boolean };

export type IncomeSummaryData = {
  range: SummaryRange;
  received: number;
  receiptCount: number;
  /** Part of `received` that settled invoices (not extra revenue). */
  receivedAgainstInvoices: number;
  /** Older income records in the range saved "On credit": not money received, so left out of `received`. */
  onCredit: { count: number; total: number };
  invoiced: number;
  invoiceCount: number;
  invoicedTaxable: number;
  outstanding: number;
  overdue: number;
  openCount: number;
  months: MonthPoint[];
  days: DayRow[];
  years: YearRow[];
  categories: CategoryRow[];
  projects: PartyRow[];
  customers: PartyRow[];
  /** The open invoices due first (overdue ones lead), at most ten. */
  openInvoices: OpenInvoiceRow[];
};

/** Every "yyyy-mm" from the month of `from` to the month of `to`. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "2026-11" → the financial year it falls in ("FY 2026-27") and that year's first day. */
function fyOfMonth(month: string): { label: string; start: string } {
  const [y, m] = month.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return { label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`, start: `${startYear}-04-01` };
}

const clientKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export async function incomeSummary(range: SummaryRange, now: Date = new Date()): Promise<IncomeSummaryData> {
  await connectDB();
  const dates = dateRangeFilter(range.from, range.to)!;
  // "On credit" is not money received: those records are left out of every received figure and counted apart.
  const receivedOnly = { paymentMethod: { $ne: "credit" } };
  const incomeMatch = { date: dates, ...receivedOnly };
  const invoiceMatch = { date: dates, status: { $ne: "cancelled" } };

  const [incomeMonths, invoiceMonths, incomeDays, categories, incomeProjects, invoiceProjects, incomeClients, invoiceClients, totals, invoiceTotals, allIncomeMonths, allInvoiceMonths, balances, onCredit] =
    await Promise.all([
      Income.aggregate<{ _id: string; total: number }>([
        { $match: incomeMatch },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: TZ } }, total: { $sum: "$amount" } } },
      ]),
      Invoice.aggregate<{ _id: string; total: number }>([
        { $match: invoiceMatch },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: TZ } }, total: { $sum: "$total" } } },
      ]),
      Income.aggregate<{ _id: string; total: number; count: number }>([
        { $match: incomeMatch },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ } }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: DAY_LIMIT },
      ]),
      Income.aggregate<{ _id: IncomeCategory; total: number; count: number }>([
        { $match: incomeMatch },
        { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      Income.aggregate<{ _id: Types.ObjectId | null; total: number }>([{ $match: incomeMatch }, { $group: { _id: "$project", total: { $sum: "$amount" } } }]),
      Invoice.aggregate<{ _id: Types.ObjectId | null; total: number }>([{ $match: invoiceMatch }, { $group: { _id: "$project", total: { $sum: "$total" } } }]),
      Income.aggregate<{ _id: string; name: string; total: number }>([
        { $match: incomeMatch },
        { $group: { _id: { $toLower: { $trim: { input: "$client" } } }, name: { $first: "$client" }, total: { $sum: "$amount" } } },
      ]),
      Invoice.aggregate<{ _id: string; name: string; total: number }>([
        { $match: invoiceMatch },
        { $group: { _id: { $toLower: { $trim: { input: "$client" } } }, name: { $first: "$client" }, total: { $sum: "$total" } } },
      ]),
      Income.aggregate<{ total: number; count: number; againstInvoices: number }>([
        { $match: incomeMatch },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
            againstInvoices: { $sum: { $cond: [{ $gt: ["$invoice", null] }, "$amount", 0] } },
          },
        },
      ]),
      Invoice.aggregate<{ total: number; taxable: number; count: number }>([
        { $match: invoiceMatch },
        { $group: { _id: null, total: { $sum: "$total" }, taxable: { $sum: "$taxableAmount" }, count: { $sum: 1 } } },
      ]),
      Income.aggregate<{ _id: string; total: number }>([
        { $match: receivedOnly },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: TZ } }, total: { $sum: "$amount" } } },
      ]),
      Invoice.aggregate<{ _id: string; total: number }>([
        { $match: { status: { $ne: "cancelled" } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: TZ } }, total: { $sum: "$total" } } },
      ]),
      // What is owed today on every open invoice, whatever its date.
      invoiceBalances(now),
      Income.aggregate<{ total: number; count: number }>([
        { $match: { date: dates, paymentMethod: "credit" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
    ]);

  const open = balances.filter((b) => b.outstanding > 0);

  // Months in the range, zero where nothing happened, so the chart shows gaps honestly.
  const receivedByMonth = new Map(incomeMonths.map((m) => [m._id, m.total]));
  const invoicedByMonth = new Map(invoiceMonths.map((m) => [m._id, m.total]));
  // Months after the current one are left off the chart unless something is dated in them.
  const today = toDateInput(now);
  const lastData = [...receivedByMonth.keys(), ...invoicedByMonth.keys()].sort().pop() ?? "";
  const chartEnd = range.to > today ? [today.slice(0, 7), lastData].sort().pop()! : range.to;
  // A range that starts long before the first record (from=2000-01-01) starts the chart at that record's month.
  const firstEver = [...allIncomeMonths.map((m) => m._id), ...allInvoiceMonths.map((m) => m._id)].filter(Boolean).sort()[0];
  const chartStart = firstEver && range.from.slice(0, 7) < firstEver ? `${firstEver}-01` : range.from;
  const months = monthsBetween(chartStart, chartEnd < chartStart ? chartStart : chartEnd).map((month) => ({
    month,
    received: round2(receivedByMonth.get(month) ?? 0),
    invoiced: round2(invoicedByMonth.get(month) ?? 0),
  }));

  // Financial years over all records.
  const years = new Map<string, YearRow>();
  const addYear = (month: string, field: "received" | "invoiced", amount: number) => {
    const fy = fyOfMonth(month);
    const row = years.get(fy.label) ?? { label: fy.label, start: fy.start, received: 0, invoiced: 0 };
    row[field] = round2(row[field] + amount);
    years.set(fy.label, row);
  };
  for (const m of allIncomeMonths) addYear(m._id, "received", m.total);
  for (const m of allInvoiceMonths) addYear(m._id, "invoiced", m.total);

  // Projects: received and invoiced in the range, outstanding today.
  const projectRows = new Map<string, PartyRow>();
  const projectRow = (id: string | null) => {
    const key = id ?? "none";
    const row = projectRows.get(key) ?? { key, name: id ? "" : "No project", href: id ? `/finance/projects/${id}` : null, received: 0, invoiced: 0, outstanding: 0, overdue: 0 };
    projectRows.set(key, row);
    return row;
  };
  for (const p of incomeProjects) projectRow(p._id ? String(p._id) : null).received = round2(p.total);
  for (const p of invoiceProjects) projectRow(p._id ? String(p._id) : null).invoiced = round2(p.total);
  for (const b of open) {
    const row = projectRow(b.project);
    row.outstanding = round2(row.outstanding + b.outstanding);
    if (b.status === "overdue") row.overdue = round2(row.overdue + b.outstanding);
  }
  const projectIds = [...projectRows.keys()].filter((k) => k !== "none" && Types.ObjectId.isValid(k)).map((k) => new Types.ObjectId(k));
  const names = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { name: 1 }).lean() : [];
  const projectName = new Map(names.map((p) => [String(p._id), p.name]));
  for (const row of projectRows.values()) if (row.key !== "none") row.name = projectName.get(row.key) ?? "Deleted project";

  // Customers, matched on the name regardless of case and spacing.
  const customerRows = new Map<string, PartyRow>();
  const customerRow = (name: string) => {
    const key = clientKey(name);
    const row = customerRows.get(key) ?? { key, name: name.trim(), href: null, received: 0, invoiced: 0, outstanding: 0, overdue: 0 };
    customerRows.set(key, row);
    return row;
  };
  for (const c of incomeClients) customerRow(c.name).received = round2(customerRow(c.name).received + c.total);
  for (const c of invoiceClients) customerRow(c.name).invoiced = round2(customerRow(c.name).invoiced + c.total);
  for (const b of open) {
    const row = customerRow(b.client);
    row.outstanding = round2(row.outstanding + b.outstanding);
    if (b.status === "overdue") row.overdue = round2(row.overdue + b.outstanding);
  }
  for (const row of customerRows.values()) {
    row.href =
      row.invoiced > 0 || row.outstanding > 0
        ? // List filters are comma-separated, so a name with a comma is searched for instead.
          `/finance/invoices?${row.name.includes(",") ? "q" : "client"}=${encodeURIComponent(row.name)}`
        : `/finance/income?q=${encodeURIComponent(row.name)}`;
  }

  const byValue = (a: PartyRow, b: PartyRow) => b.received + b.invoiced + b.outstanding - (a.received + a.invoiced + a.outstanding);

  return {
    range,
    received: round2(totals[0]?.total ?? 0),
    receiptCount: totals[0]?.count ?? 0,
    receivedAgainstInvoices: round2(totals[0]?.againstInvoices ?? 0),
    onCredit: { count: onCredit[0]?.count ?? 0, total: round2(onCredit[0]?.total ?? 0) },
    invoiced: round2(invoiceTotals[0]?.total ?? 0),
    invoiceCount: invoiceTotals[0]?.count ?? 0,
    invoicedTaxable: round2(invoiceTotals[0]?.taxable ?? 0),
    outstanding: round2(open.reduce((s, b) => s + b.outstanding, 0)),
    overdue: round2(open.filter((b) => b.status === "overdue").reduce((s, b) => s + b.outstanding, 0)),
    openCount: open.length,
    months,
    days: incomeDays.map((d) => ({ day: d._id, received: round2(d.total), count: d.count })),
    years: [...years.values()].sort((a, b) => b.start.localeCompare(a.start)),
    categories: categories.map((c) => ({ category: c._id ?? "other", received: round2(c.total), count: c.count })),
    projects: [...projectRows.values()].sort(byValue),
    customers: [...customerRows.values()].sort(byValue),
    openInvoices: open
      .slice()
      .sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date))
      .slice(0, OPEN_INVOICE_LIMIT)
      .map((b) => ({ id: b.id, number: b.number, client: b.client, date: b.date, dueDate: b.dueDate, outstanding: b.outstanding, overdue: b.status === "overdue" })),
  };
}
