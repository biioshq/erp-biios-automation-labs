import "server-only";

import { balanceSheet, cashFlow, periodFromInputs, trialBalance } from "@/server/accounting/statements";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { PL_SECTION_LABELS, type AccountType, type PlSection, type ProfitAndLoss } from "@/lib/accounting";
import { col, periodText, sumTotals } from "../common";
import { plColumns, type PlColumnsResult } from "../pl-columns";
import { STATEMENT_COLUMNS, asOfText, checkItem, heading, lineRows, totalRow } from "./statement-rows";
import type { ReportColumn, ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/**
 * The four financial statements as report files. Every figure comes from
 * src/server/accounting/statements.ts, the same functions the statement pages show.
 */

const asOfDate = (f: ReportFilters) => (f.to ? fromDateInput(f.to) : null);

/* Balance sheet */

export async function buildBalanceSheetReport(f: ReportFilters): Promise<ReportData> {
  const sheet = await balanceSheet(asOfDate(f));
  const rows: ReportRow[] = [
    heading("Assets"),
    heading("Current assets"),
    ...lineRows(sheet.assets.current, 1),
    totalRow("Total current assets", sheet.assets.totalCurrent),
    heading("Non-current assets"),
    ...lineRows(sheet.assets.nonCurrent, 1),
    totalRow("Total non-current assets", sheet.assets.totalNonCurrent),
    totalRow("Total assets", sheet.assets.total),
    heading("Liabilities"),
    heading("Current liabilities"),
    ...lineRows(sheet.liabilities.current, 1),
    totalRow("Total current liabilities", sheet.liabilities.totalCurrent),
    heading("Non-current liabilities"),
    ...lineRows(sheet.liabilities.nonCurrent, 1),
    totalRow("Total non-current liabilities", sheet.liabilities.totalNonCurrent),
    totalRow("Total liabilities", sheet.liabilities.total),
    heading("Equity"),
    ...lineRows(sheet.equity.lines, 1),
    totalRow("Total equity", sheet.equity.total),
    totalRow("Total liabilities and equity", round2(sheet.liabilities.total + sheet.equity.total)),
  ];
  return {
    type: "balance_sheet",
    title: "Balance sheet",
    subtitle: `${asOfText(sheet.asOf)} · From the books: every record read as its debit and credit`,
    columns: STATEMENT_COLUMNS,
    rows,
    totals: null,
    statement: true,
    summary: [
      { label: "Total assets", value: sheet.assets.total, type: "money" },
      { label: "Total liabilities", value: sheet.liabilities.total, type: "money" },
      { label: "Total equity", value: sheet.equity.total, type: "money" },
      checkItem(sheet.difference, "Assets against liabilities and equity"),
    ],
  };
}

/* Profit & loss */

const COST_SECTIONS: PlSection[] = ["materials", "direct"];
const OTHER_COST_SECTIONS: PlSection[] = ["indirect", "depreciation", "finance", "other_expense"];

type Pick = (pl: ProfitAndLoss) => number | null;

/** The rows of a Profit & Loss with one value column per statement in `results` (the last is the total). */
export function plRows(results: ProfitAndLoss[], keys: string[]): ReportRow[] {
  const row = (line: string, pick: Pick, kind?: "subtotal"): ReportRow => {
    const r: ReportRow = { line };
    results.forEach((res, i) => (r[keys[i]] = pick(res)));
    if (kind) r._kind = kind;
    return r;
  };
  const sectionOf = (res: ProfitAndLoss, key: PlSection) => res.sections.find((s) => s.key === key);
  const sectionTotal = (key: PlSection): Pick => (res) => sectionOf(res, key)?.total ?? 0;

  const section = (key: PlSection): ReportRow[] => {
    // Every line any column has, in the order of the total column (largest first), then the rest.
    const labels = new Map<string, string>();
    for (const res of [...results].reverse()) for (const l of sectionOf(res, key)?.lines ?? []) if (!labels.has(l.key)) labels.set(l.key, l.label);
    if (!labels.size) return [];
    return [
      row(PL_SECTION_LABELS[key], () => null, "subtotal"),
      ...[...labels].map(([lineKey, label]) => row(`    ${label}`, (res) => sectionOf(res, key)?.lines.find((l) => l.key === lineKey)?.amount ?? null)),
      row(`Total ${PL_SECTION_LABELS[key].toLowerCase()}`, sectionTotal(key), "subtotal"),
    ];
  };

  return [
    ...section("revenue"),
    ...COST_SECTIONS.flatMap(section),
    row("Gross profit (revenue less materials and direct costs)", (res) => res.grossProfit, "subtotal"),
    ...section("other_income"),
    ...OTHER_COST_SECTIONS.flatMap(section),
    row("Total income", (res) => res.totalIncome, "subtotal"),
    row("Total expenses", (res) => res.totalExpenses, "subtotal"),
    row("Net profit (loss when negative)", (res) => res.profit, "subtotal"),
  ];
}

/** Columns for a P&L layout: "Line", one per sub-period, then the total. */
export function plColumnsOf(data: PlColumnsResult): { columns: ReportColumn[]; keys: string[]; results: ProfitAndLoss[] } {
  const many = data.periods.length > 0;
  const columns = [
    col("line", "Line", "text", 40),
    ...data.periods.map((p) => col(p.key, p.label, "money", 14)),
    col("total", many ? "Total" : "Amount", "money", 16),
  ];
  return { columns, keys: [...data.periods.map((p) => p.key), "total"], results: [...data.columns, data.total] };
}

const MODE_TEXT = { total: "", month: "Monthly columns", quarter: "Quarterly columns (financial-year quarters)", year: "Yearly columns (financial years)" } as const;

export const PL_NOTES = [
  "Stock is an asset until it is used: a stock purchase adds to Inventory on the balance sheet, and its cost reaches this statement when the stock is assigned to a project (cost of materials consumed) or written off.",
  "GST on bills is input tax credit, not a cost: expenses here are shown without the GST that can be claimed back. GST charged on invoices is owed to the government, not income.",
  "This statement is on the accrual basis: income when invoiced, expenses when billed, depreciation month by month. The expense and Finance report totals count every bill in full on its date, GST and stock purchases included, so they differ from the figures here.",
];

export async function buildProfitLossReport(f: ReportFilters): Promise<ReportData> {
  const period = periodFromInputs(f.from, f.to);
  const data = await plColumns(period.from, period.to, f.columns ?? "total");
  const { columns, keys, results } = plColumnsOf(data);
  const pl = data.total;
  const fallback = data.mode !== data.requested ? `${MODE_TEXT[data.requested]} would need more than 24 columns, so ${MODE_TEXT[data.mode].toLowerCase()} are shown` : MODE_TEXT[data.mode];
  const statement: ReportSection = { title: "Profit and loss", columns, rows: plRows(results, keys), totals: null };
  const notes: ReportSection = { title: "How to read it", columns: [col("note", "Note", "text", 90)], rows: PL_NOTES.map((note) => ({ note })), totals: null };
  return {
    type: "profit_loss",
    subtitle: [`Period: ${periodText({ from: pl.from, to: pl.to })}`, fallback].filter(Boolean).join(" · "),
    statement: true,
    summary: [
      { label: "Total income", value: pl.totalIncome, type: "money" },
      { label: "Total expenses", value: pl.totalExpenses, type: "money" },
      { label: "Gross profit", value: pl.grossProfit, type: "money" },
      { label: "Net profit", value: pl.profit, type: "money" },
    ],
    ...statement,
    title: "Profit & loss statement",
    sections: [statement, notes],
  };
}

/* Cash flow */

export async function buildCashFlowReport(f: ReportFilters): Promise<ReportData> {
  const period = periodFromInputs(f.from, f.to);
  const cf = await cashFlow(period.from, period.to);
  const columns = [col("line", "Line", "text", 46), col("amount", "Amount", "money", 18)];
  const rows: ReportRow[] = [];
  for (const a of cf.activities) {
    rows.push({ line: a.label, amount: null, _kind: "subtotal" });
    if (!a.lines.length) rows.push({ line: "    No cash moved", amount: null });
    for (const l of a.lines) rows.push({ line: `    ${l.label}`, amount: l.amount });
    rows.push({ line: `Net cash from ${a.label.toLowerCase()}`, amount: a.net, _kind: "subtotal" });
  }
  rows.push(
    { line: "Net change in cash", amount: cf.netChange, _kind: "subtotal" },
    { line: "Cash at the start of the period", amount: cf.opening },
    { line: "Cash at the end of the period", amount: cf.closing, _kind: "subtotal" },
  );
  const statement: ReportSection = { title: "Cash flow statement", columns, rows, totals: null };
  const accountColumns = [
    col("account", "Account", "text", 30),
    col("opening", "Opening", "money", 16),
    col("inflow", "Money in", "money", 16),
    col("outflow", "Money out", "money", 16),
    col("closing", "Closing", "money", 16),
  ];
  const accountRows: ReportRow[] = cf.accounts.map((a) => ({ account: a.name, opening: a.opening, inflow: a.inflow, outflow: a.outflow, closing: a.closing }));
  const accounts: ReportSection = { title: "Cash by account", columns: accountColumns, rows: accountRows, totals: sumTotals(accountColumns, accountRows) };
  const net = (k: string) => cf.activities.find((a) => a.key === k)?.net ?? 0;
  return {
    type: "cash_flow",
    subtitle: `Period: ${periodText({ from: cf.from, to: cf.to })} · Direct method · Cash by account includes transfers between own accounts`,
    statement: true,
    summary: [
      { label: "Opening cash", value: cf.opening, type: "money" },
      { label: "Operating", value: net("operating"), type: "money" },
      { label: "Investing", value: net("investing"), type: "money" },
      { label: "Financing", value: net("financing"), type: "money" },
      { label: "Closing cash", value: cf.closing, type: "money" },
    ],
    ...statement,
    title: "Cash flow statement",
    sections: [statement, accounts],
  };
}

/* Trial balance */

const TYPE_LABELS: Record<AccountType, string> = { asset: "Asset", liability: "Liability", equity: "Equity", income: "Income", expense: "Expense" };

export async function buildTrialBalanceReport(f: ReportFilters): Promise<ReportData> {
  const tb = await trialBalance(asOfDate(f));
  const columns = [col("account", "Account", "text", 40), col("kind", "Type", "text", 12), col("debit", "Debit", "money", 18), col("credit", "Credit", "money", 18)];
  const rows: ReportRow[] = tb.rows.map((r) => ({ account: r.name, kind: TYPE_LABELS[r.type], debit: r.debit || null, credit: r.credit || null }));
  return {
    type: "trial_balance",
    title: "Trial balance",
    subtitle: `${asOfText(tb.asOf)} · Balance of every ledger account computed from the records`,
    columns,
    rows,
    totals: { account: "Total", debit: tb.debit, credit: tb.credit },
    summary: [
      { label: "Accounts", value: rows.length, type: "number" },
      { label: "Total debits", value: tb.debit, type: "money" },
      { label: "Total credits", value: tb.credit, type: "money" },
      checkItem(round2(tb.debit - tb.credit), "Debits against credits"),
    ],
  };
}

