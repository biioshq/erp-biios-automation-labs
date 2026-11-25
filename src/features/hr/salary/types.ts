import type { HrRules } from "../constants";
import type { SalaryLine } from "./calc";

/** Types and small helpers shared by the salary page, its components and the export. Client-safe. */

/** A salary line as the page shows it, with what Expenses already hold for that person and month. */
export type SalaryRow = SalaryLine & {
  /** Sum of "salaries" expenses for this person dated in the month; null without the salaries permission. */
  booked: number | null;
};

export type SalaryTotals = {
  people: number;
  monthlySalary: number;
  earned: number;
  lopDays: number;
  /** Pay lost to loss-of-pay days (monthly salary × LOP days ÷ base days, per person). */
  lopAmount: number;
  overtimeMinutes: number;
  overtimePay: number;
  additions: number;
  deductions: number;
  net: number;
  /** Working days nobody marked, up to today. */
  unmarked: number;
};

export type SalaryRunInfo = {
  status: "finalised" | "reopened";
  finalisedAt: string | null;
  finalisedByName: string | null;
  reopenedAt: string | null;
  reopenedByName: string | null;
};

export type SalaryMonthData = {
  month: string;
  rules: HrRules;
  rows: SalaryRow[];
  totals: SalaryTotals;
  /** True when the lines are the stored ones of a finalised month. */
  finalised: boolean;
  run: SalaryRunInfo | null;
  /** True when amounts were loaded (the person holds "data.salaries"). */
  withSalary: boolean;
  /** Sum of `booked`, or null without amounts. */
  bookedTotal: number | null;
};

/** "2026-11" → "November 2026". */
export function monthLabel(month: string): string {
  return new Date(`${month}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
