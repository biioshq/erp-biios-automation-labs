import "server-only";

import { profitAndLoss } from "@/server/accounting/statements";
import { addDays, endOfDayIST, financialYearIST, fromDateInput, startOfMonthIST, toDateInput } from "@/lib/dates";
import type { ProfitAndLoss } from "@/lib/accounting";
import type { PlColumns } from "../types";

/**
 * The Profit & Loss split into columns: each month, Indian financial-year quarter (Q1 is April to
 * June) or financial year of the period, the first and last clipped to it. Every column is its own
 * profitAndLoss() call, and the total column is one call over the whole period, so each figure is
 * exactly what the statement gives for that span.
 */

export type PlPeriod = { key: string; label: string; from: string; to: string };

export type PlColumnsResult = {
  /** The layout used: a long period asked for by month falls back to quarters (or years). */
  mode: PlColumns;
  requested: PlColumns;
  periods: PlPeriod[];
  /** One statement per period, in order. Empty for the "total" layout. */
  columns: ProfitAndLoss[];
  total: ProfitAndLoss;
};

/** At most this many columns: each one computes the books up to its end. */
export const MAX_PL_COLUMNS = 24;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The first day of the next month, quarter or financial year after `day` ("yyyy-mm-dd"). */
function nextBoundary(day: string, mode: Exclude<PlColumns, "total">): string {
  const date = fromDateInput(day);
  const m = Number(day.slice(5, 7));
  if (mode === "month") return toDateInput(startOfMonthIST(date, 1));
  if (mode === "quarter") return toDateInput(startOfMonthIST(date, 3 - ((m - 1) % 3)));
  return toDateInput(addDays(financialYearIST(date).end, 1));
}

function labelOf(day: string, mode: Exclude<PlColumns, "total">): string {
  const [y, m] = day.split("-").map(Number);
  if (mode === "month") return `${MONTHS[m - 1]} ${y}`;
  const fy = financialYearIST(fromDateInput(day));
  if (mode === "year") return fy.label;
  return `Q${Math.floor(((m - 4 + 12) % 12) / 3) + 1} ${fy.label}`;
}

/** The sub-periods of [from, to] ("yyyy-mm-dd", both inclusive). */
export function splitPeriod(from: string, to: string, mode: Exclude<PlColumns, "total">): PlPeriod[] {
  const out: PlPeriod[] = [];
  let start = from;
  while (start <= to && out.length <= MAX_PL_COLUMNS) {
    const next = nextBoundary(start, mode);
    const end = toDateInput(addDays(fromDateInput(next), -1));
    out.push({ key: `p${out.length}`, label: labelOf(start, mode), from: start, to: end < to ? end : to });
    start = next;
  }
  return out;
}

export async function plColumns(from: Date, to: Date, requested: PlColumns = "total"): Promise<PlColumnsResult> {
  const total = await profitAndLoss(from, to);
  if (requested === "total") return { mode: "total", requested, periods: [], columns: [], total };

  // total.to is the last day the books were computed for (never after today).
  const fromDay = toDateInput(from);
  const toDay = total.to;
  let mode: Exclude<PlColumns, "total"> = requested;
  let periods = splitPeriod(fromDay, toDay, mode);
  if (periods.length > MAX_PL_COLUMNS && mode === "month") {
    mode = "quarter";
    periods = splitPeriod(fromDay, toDay, mode);
  }
  if (periods.length > MAX_PL_COLUMNS) {
    mode = "year";
    periods = splitPeriod(fromDay, toDay, mode);
  }
  periods = periods.slice(0, MAX_PL_COLUMNS);
  // One at a time: each call builds the books up to its own end day.
  const columns: ProfitAndLoss[] = [];
  for (const p of periods) columns.push(await profitAndLoss(fromDateInput(p.from), endOfDayIST(fromDateInput(p.to))));
  return { mode, requested, periods, columns, total };
}
