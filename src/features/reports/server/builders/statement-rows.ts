import "server-only";

import { fromDateInput } from "@/lib/dates";
import { formatCurrency, formatDate } from "@/lib/format";
import type { StatementLine } from "@/lib/accounting";
import { col } from "../common";
import type { ReportColumn, ReportRow, SummaryItem } from "../../types";

/**
 * Rows for statements (balance sheet, liabilities and equity summaries). A group line carries its
 * amount in "Amount"; its child lines (accounts, subgroups) carry theirs in "Detail", so a column
 * never adds a figure twice. Headings and totals are subtotal rows (bold in PDF and Excel).
 */
export const STATEMENT_COLUMNS: ReportColumn[] = [col("line", "Line", "text", 46), col("detail", "Detail", "money", 16), col("amount", "Amount", "money", 18)];

const INDENT = "    ";

export const heading = (text: string): ReportRow => ({ line: text, detail: null, amount: null, _kind: "subtotal" });
export const totalRow = (text: string, amount: number): ReportRow => ({ line: text, detail: null, amount, _kind: "subtotal" });
export const plainRow = (text: string, amount: number | null, depth = 1): ReportRow => ({ line: `${INDENT.repeat(depth)}${text}`, detail: null, amount });
export const detailRow = (text: string, amount: number, depth = 2): ReportRow => ({ line: `${INDENT.repeat(depth)}${text}`, detail: amount, amount: null });

/** A group's lines, each followed by its child lines. */
export function lineRows(lines: StatementLine[], depth = 1): ReportRow[] {
  const out: ReportRow[] = [];
  for (const l of lines) {
    out.push(plainRow(l.label, l.amount, depth));
    for (const c of l.children ?? []) out.push(detailRow(c.label, c.amount, depth + 1));
  }
  return out;
}

/** "Balanced" when the two sides agree to the paisa, otherwise by how much they differ. */
export function checkItem(difference: number, label = "Check"): SummaryItem {
  return { label, value: Math.abs(difference) < 0.005 ? "Balanced" : `Out by ${formatCurrency(difference, { exact: true })}`, type: "text" };
}

export const asOfText = (asOf: string) => `As of ${formatDate(fromDateInput(asOf))}`;

/** Days a due date is behind today (0 when not overdue). */
export function daysOverdue(due: string | null, today: string): number | null {
  if (!due || due >= today) return null;
  return Math.round((fromDateInput(today).getTime() - fromDateInput(due).getTime()) / 86_400_000);
}
