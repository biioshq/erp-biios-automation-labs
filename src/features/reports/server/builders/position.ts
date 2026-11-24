import "server-only";

import { connectDB } from "@/server/db";
import { CapitalEntry, EquityHolder, Project } from "@/server/models";
import { equityOverview, liabilitiesOverview, liabilityRows, payablesSummary, receivablesSummary } from "@/server/finance/summaries";
import { effectiveAsOf } from "@/server/accounting/ledger";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { CAPITAL_ENTRY_TYPES, EQUITY_HOLDER_KINDS, INVESTOR_INSTRUMENTS, LIABILITY_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, labelOf } from "@/lib/constants";
import type { EquityHolderKind, InvestorInstrument, LiabilityStatus, PaymentMethod, PaymentStatus } from "@/lib/constants";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { col, day, sumTotals } from "../common";
import { STATEMENT_COLUMNS, asOfText, daysOverdue, detailRow, heading, lineRows, plainRow, totalRow } from "./statement-rows";
import type { ReportColumn, ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/**
 * What customers owe, what is owed to vendors and lenders, and the equity position, from
 * src/server/finance/summaries.ts. Receivables, payables and loans are as of today: their balances
 * count every payment recorded, whatever its date.
 */

async function projectNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const docs = await Project.find({ _id: { $in: unique } }, { name: 1 }).lean();
  return new Map(docs.map((p) => [String(p._id), p.name]));
}

const todayText = () => asOfText(toDateInput(new Date()));

/* Receivables */

export async function buildReceivablesReport(f: ReportFilters): Promise<ReportData> {
  void f;
  await connectDB();
  const now = new Date();
  const today = toDateInput(now);
  const r = await receivablesSummary(now);
  const names = await projectNames(r.rows.map((x) => x.project));

  const customerColumns: ReportColumn[] = [
    col("client", "Customer", "text", 30),
    col("invoices", "Open invoices", "number", 10),
    col("outstanding", "Outstanding", "money", 17),
    col("overdue", "Overdue", "money", 17),
    col("share", "Share", "percent", 9),
  ];
  const customerRows: ReportRow[] = r.byClient.map((c) => ({ client: c.client, invoices: c.invoices, outstanding: c.outstanding, overdue: c.overdue, share: r.total > 0 ? c.outstanding / r.total : 0 }));
  const customers: ReportSection = {
    title: "By customer",
    columns: customerColumns,
    rows: customerRows,
    totals: { ...sumTotals(customerColumns, customerRows, "Total", ["money", "number"]), share: customerRows.length ? 1 : 0 },
  };

  const invoiceColumns: ReportColumn[] = [
    col("number", "Invoice", "text", 14),
    col("client", "Customer", "text", 24),
    col("project", "Project", "text", 20),
    col("date", "Date", "date", 12),
    col("due", "Due", "date", 12),
    col("total", "Invoice total", "money", 15),
    col("received", "Received", "money", 15),
    col("outstanding", "Outstanding", "money", 15),
    col("status", "Status", "text", 11),
    col("late", "Days overdue", "number", 9),
  ];
  const invoiceRows: ReportRow[] = r.rows.map((x) => ({
    number: x.number,
    client: x.client,
    project: x.project ? (names.get(x.project) ?? "") : "",
    date: x.date,
    due: x.dueDate,
    total: x.total,
    received: x.received,
    outstanding: x.outstanding,
    status: labelOf(PAYMENT_STATUSES, x.status as PaymentStatus),
    late: x.status === "overdue" ? daysOverdue(x.dueDate, today) : null,
  }));
  const invoices: ReportSection = { title: "Open invoices", columns: invoiceColumns, rows: invoiceRows, totals: sumTotals(invoiceColumns, invoiceRows) };

  return {
    type: "receivables",
    subtitle: `${todayText()} · Invoices not fully received, from income records linked to each invoice`,
    summary: [
      { label: "Outstanding", value: r.total, type: "money" },
      { label: "Overdue", value: r.overdue, type: "money" },
      { label: "Due in the next 30 days", value: r.dueSoon, type: "money" },
      { label: "Open invoices", value: r.count, type: "number" },
    ],
    ...customers,
    title: "Receivables report",
    sections: [customers, invoices],
  };
}

/* Payables */

export async function buildPayablesReport(f: ReportFilters): Promise<ReportData> {
  void f;
  await connectDB();
  const now = new Date();
  const today = toDateInput(now);
  const [p, categoryLabel] = await Promise.all([payablesSummary(now), getExpenseCategoryLabeler()]);
  const names = await projectNames(p.rows.map((x) => x.project));

  const vendorColumns: ReportColumn[] = [
    col("vendor", "Vendor", "text", 30),
    col("bills", "Open bills", "number", 10),
    col("outstanding", "Outstanding", "money", 17),
    col("overdue", "Overdue", "money", 17),
    col("share", "Share", "percent", 9),
  ];
  const vendorRows: ReportRow[] = p.byVendor.map((v) => ({ vendor: v.vendor, bills: v.bills, outstanding: v.outstanding, overdue: v.overdue, share: p.total > 0 ? v.outstanding / p.total : 0 }));
  const vendors: ReportSection = {
    title: "By vendor",
    columns: vendorColumns,
    rows: vendorRows,
    totals: { ...sumTotals(vendorColumns, vendorRows, "Total", ["money", "number"]), share: vendorRows.length ? 1 : 0 },
  };

  const billColumns: ReportColumn[] = [
    col("number", "Expense", "text", 14),
    col("vendor", "Vendor", "text", 22),
    col("category", "Category", "text", 18),
    col("project", "Project", "text", 18),
    col("date", "Bill date", "date", 12),
    col("due", "Due", "date", 12),
    col("amount", "Amount", "money", 15),
    col("paid", "Paid", "money", 15),
    col("outstanding", "Outstanding", "money", 15),
    col("status", "Status", "text", 11),
    col("late", "Days overdue", "number", 9),
  ];
  const billRows: ReportRow[] = p.rows.map((x) => ({
    number: x.number,
    vendor: x.vendor,
    category: categoryLabel(x.category),
    project: x.project ? (names.get(x.project) ?? "") : "",
    date: x.date,
    due: x.dueDate,
    amount: x.amount,
    paid: x.paid,
    outstanding: x.outstanding,
    status: labelOf(PAYMENT_STATUSES, x.status as PaymentStatus),
    late: x.status === "overdue" ? daysOverdue(x.dueDate, today) : null,
  }));
  const bills: ReportSection = { title: "Open bills", columns: billColumns, rows: billRows, totals: sumTotals(billColumns, billRows) };
  const overdueRows = billRows.filter((b) => b.late !== null);
  const overdue: ReportSection = { title: "Overdue bills", columns: billColumns, rows: overdueRows, totals: sumTotals(billColumns, overdueRows) };

  return {
    type: "payables",
    subtitle: `${todayText()} · Expenses not fully paid (bills on credit and part payments) · A bill with no due date is due on its date`,
    summary: [
      { label: "Outstanding", value: p.total, type: "money" },
      { label: "Overdue", value: p.overdue, type: "money" },
      { label: "Due in the next 30 days", value: p.dueSoon, type: "money" },
      { label: "Open bills", value: p.count, type: "number" },
    ],
    ...vendors,
    title: "Payables report",
    sections: [vendors, bills, overdue],
  };
}

/* Liabilities */

export async function buildLiabilitiesReport(f: ReportFilters): Promise<ReportData> {
  void f;
  await connectDB();
  const now = new Date();
  const [overview, loans, groups] = await Promise.all([liabilitiesOverview(now), liabilityRows(now), loadFinanceGroups("liability", { includeArchived: true })]);
  const groupLabel = new Map(groups.map((g) => [g.key, g.label]));
  // Current or not by where the group sits in the tree, so a subgroup added under a current group counts as current.
  const currentGroups = new Set(descendantsOf(groups, "current_liabilities"));

  const summaryRows: ReportRow[] = [
    heading("Current liabilities"),
    ...lineRows(overview.currentLines, 1),
    totalRow("Total current liabilities", overview.current),
    heading("Non-current liabilities"),
    ...lineRows(overview.nonCurrentLines, 1),
    totalRow("Total non-current liabilities", overview.nonCurrent),
    totalRow("Total liabilities", overview.total),
  ];
  const summarySection: ReportSection = { title: "Liabilities summary", columns: STATEMENT_COLUMNS, rows: summaryRows, totals: null };

  const loanColumns: ReportColumn[] = [
    col("code", "Code", "text", 10),
    col("name", "Liability", "text", 22),
    col("lender", "Lender", "text", 18),
    col("group", "Group", "text", 18),
    col("term", "Term", "text", 11),
    col("original", "Original", "money", 15),
    col("paid", "Principal paid", "money", 15),
    col("outstanding", "Outstanding", "money", 15),
    col("interest", "Interest paid", "money", 13),
    col("rate", "Rate (% a year)", "number", 9),
    col("date", "Taken on", "date", 12),
    col("due", "Due", "date", 12),
    col("status", "Status", "text", 10),
  ];
  const loanRows: ReportRow[] = loans.map((l) => ({
    code: l.code,
    name: l.name,
    lender: l.lender,
    group: groupLabel.get(l.group) ?? l.group,
    term: currentGroups.has(l.group) ? "Current" : "Non-current",
    original: l.originalAmount,
    paid: l.principalPaid,
    outstanding: l.outstanding,
    interest: l.interestPaid,
    rate: l.interestRate,
    date: l.date,
    due: l.dueDate,
    status: labelOf(LIABILITY_STATUSES, l.status as LiabilityStatus),
  }));
  const loanSection: ReportSection = { title: "Loan outstanding", columns: loanColumns, rows: loanRows, totals: sumTotals(loanColumns, loanRows) };

  return {
    type: "liabilities",
    subtitle: `${todayText()} · Totals from the balance sheet; loans and other obligations entered on the Liabilities pages · Interest is booked as an expense`,
    summary: [
      { label: "Total liabilities", value: overview.total, type: "money" },
      { label: "Current", value: overview.current, type: "money" },
      { label: "Non-current", value: overview.nonCurrent, type: "money" },
      { label: "Overdue (loans and bills)", value: overview.overdue, type: "money" },
    ],
    ...summarySection,
    title: "Liabilities report",
    statement: true,
    sections: [summarySection, loanSection],
  };
}

/* Capital and equity */

export async function buildEquityReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const asOf = effectiveAsOf(f.to ? fromDateInput(f.to) : null);
  const [eq, holders, entries] = await Promise.all([
    equityOverview(asOf),
    EquityHolder.find({}, { name: 1, kind: 1, instrument: 1 }).lean(),
    CapitalEntry.find({ date: { $lte: asOf } }).sort({ date: 1, number: 1 }).lean(),
  ]);
  const holderById = new Map(holders.map((h) => [String(h._id), h]));
  const holderName = (id: unknown) => (id ? (holderById.get(String(id))?.name ?? "") : "");

  const summaryRows: ReportRow[] = [...lineRows(eq.lines, 0), totalRow("Total equity", eq.total)];
  const summarySection: ReportSection = { title: "Equity summary", columns: STATEMENT_COLUMNS, rows: summaryRows, totals: null };

  const ownerColumns: ReportColumn[] = [
    col("name", "Owner", "text", 24),
    col("ownership", "Ownership", "percent", 10),
    col("initial", "Initial capital", "money", 15),
    col("additional", "Added later", "money", 15),
    col("capital", "Capital introduced", "money", 16),
    col("drawings", "Drawings", "money", 15),
    col("net", "Net capital", "money", 16),
    col("first", "First contribution", "date", 13),
    col("last", "Last contribution", "date", 13),
  ];
  const holderRow = (h: (typeof eq.holders)[number]): ReportRow => ({
    name: h.archived ? `${h.name} (archived)` : h.name,
    ownership: h.ownershipPercent === null ? null : h.ownershipPercent / 100,
    initial: h.initial,
    additional: h.additional,
    capital: h.capital,
    drawings: h.drawings,
    dividends: h.dividends,
    net: h.net,
    first: h.firstContribution,
    last: h.lastContribution,
  });
  const ownerRows = eq.holders.filter((h) => h.kind === "owner").map(holderRow);
  const owners: ReportSection = { title: "Owners' capital", columns: ownerColumns, rows: ownerRows, totals: sumTotals(ownerColumns, ownerRows) };

  const investorColumns: ReportColumn[] = [
    col("name", "Investor", "text", 24),
    col("instrument", "Instrument", "text", 16),
    col("ownership", "Ownership", "percent", 10),
    col("capital", "Capital invested", "money", 16),
    col("dividends", "Dividends paid", "money", 15),
    col("first", "First investment", "date", 13),
    col("last", "Last investment", "date", 13),
  ];
  const investorRows = eq.holders
    .filter((h) => h.kind === "investor")
    .map((h) => {
      const instrument = holderById.get(h.id)?.instrument;
      return { ...holderRow(h), instrument: instrument ? labelOf(INVESTOR_INSTRUMENTS, instrument as InvestorInstrument) : "" };
    });
  const investors: ReportSection = { title: "Investors' capital", columns: investorColumns, rows: investorRows, totals: sumTotals(investorColumns, investorRows) };

  const historyColumns: ReportColumn[] = [
    col("number", "Entry", "text", 15),
    col("date", "Date", "date", 12),
    col("holder", "Owner or investor", "text", 22),
    col("kind", "Holder type", "text", 10),
    col("contribution", "Contribution", "text", 11),
    col("method", "Received by", "text", 14),
    col("reference", "Reference", "text", 14),
    col("amount", "Amount", "money", 16),
  ];
  const historyRows: ReportRow[] = entries
    .filter((e) => e.type === "capital")
    .map((e) => {
      const h = e.holder ? holderById.get(String(e.holder)) : undefined;
      return {
        number: e.number,
        date: day(e.date),
        holder: holderName(e.holder),
        kind: h ? labelOf(EQUITY_HOLDER_KINDS, h.kind as EquityHolderKind) : "",
        contribution: e.initial ? "Initial" : "Additional",
        method: e.paymentMethod ? labelOf(PAYMENT_METHODS, e.paymentMethod as PaymentMethod) : "",
        reference: e.reference ?? "",
        amount: e.amount,
      };
    });
  const history: ReportSection = { title: "Contribution history", columns: historyColumns, rows: historyRows, totals: sumTotals(historyColumns, historyRows) };

  const drawingColumns: ReportColumn[] = [
    col("number", "Entry", "text", 15),
    col("date", "Date", "date", 12),
    col("holder", "Owner", "text", 22),
    col("method", "Paid by", "text", 14),
    col("purpose", "Purpose", "text", 28),
    col("amount", "Amount", "money", 16),
  ];
  const drawingRows: ReportRow[] = entries
    .filter((e) => e.type === "drawing")
    .map((e) => ({
      number: e.number,
      date: day(e.date),
      holder: holderName(e.holder),
      method: e.paymentMethod ? labelOf(PAYMENT_METHODS, e.paymentMethod as PaymentMethod) : "",
      purpose: e.purpose ?? "",
      amount: e.amount,
    }));
  const drawings: ReportSection = { title: "Drawings", columns: drawingColumns, rows: drawingRows, totals: sumTotals(drawingColumns, drawingRows) };

  // Retained earnings: the balance sheet's line and its parts, then what already came out of it.
  const retained = eq.retainedLine;
  const openingRetained = round2(entries.filter((e) => e.type === "opening_retained").reduce((sum, e) => sum + e.amount, 0));
  const retainedRows: ReportRow[] = [
    ...(retained ? lineRows([retained], 0) : [plainRow("Retained earnings", 0, 0)]),
    heading("Already counted in the figure above"),
    detailRow(`${labelOf(CAPITAL_ENTRY_TYPES, "opening_retained")} (added)`, openingRetained, 1),
    detailRow("Dividends paid to date (deducted)", eq.dividends, 1),
    detailRow("Transferred to reserves to date (deducted)", eq.reservesTransferred, 1),
  ];
  const retainedSection: ReportSection = { title: "Retained earnings", columns: STATEMENT_COLUMNS, rows: retainedRows, totals: null };

  return {
    type: "equity",
    subtitle: `${asOfText(eq.asOf)} · Capital is never income and drawings are never expenses · Totals agree with the balance sheet`,
    summary: [
      { label: "Owner's capital", value: eq.ownersCapital, type: "money" },
      { label: "Investors' capital", value: eq.investorsCapital, type: "money" },
      { label: "Drawings", value: eq.drawings, type: "money" },
      { label: "Retained earnings", value: eq.retainedEarnings, type: "money" },
      { label: "Total equity", value: eq.total, type: "money" },
    ],
    ...summarySection,
    title: "Capital and equity report",
    statement: true,
    sections: [summarySection, owners, investors, history, drawings, retainedSection],
  };
}
