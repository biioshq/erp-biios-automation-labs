import { toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";

/**
 * The planned repayment (EMI) schedule of a loan, worked out from its terms each time it is shown.
 * Never stored: change the terms and the plan changes with them. Client-safe.
 *
 * Reducing balance, monthly: each instalment pays the month's interest on what is still owed and
 * the rest goes to principal. Instalment n falls n months after the day the loan was taken.
 */

export type ScheduleRow = {
  n: number;
  dueDate: string;
  installment: number;
  interest: number;
  principal: number;
  /** Principal still owed after this instalment. */
  balance: number;
  /** covered: the principal repaid so far reaches this instalment; due: its date has passed and it is not covered. */
  status: "covered" | "due" | "upcoming";
};

export type Schedule = {
  rows: ScheduleRow[];
  totalInterest: number;
  /** Planned interest on the instalments not covered yet. */
  interestRemaining: number;
  next: ScheduleRow | null;
  /** Set when the terms do not repay the loan as entered. */
  warning: string | null;
};

export type LoanTerms = {
  originalAmount: number;
  interestRate: number | null;
  tenureMonths: number | null;
  installment: number | null;
  /** "yyyy-mm-dd" the loan was taken. */
  date: string;
};

/** "2026-01-31" plus 1 month is "2026-02-28": the day is kept where the month has it. */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export const hasScheduleTerms = (t: LoanTerms) =>
  t.interestRate !== null && t.interestRate >= 0 && Boolean(t.tenureMonths && t.tenureMonths > 0) && Boolean(t.installment && t.installment > 0) && t.originalAmount > 0;

/** The plan, or null when the rate, tenure or instalment is missing. */
export function emiSchedule(terms: LoanTerms, principalPaid: number, today: Date = new Date()): Schedule | null {
  if (!hasScheduleTerms(terms)) return null;
  const monthly = (terms.interestRate ?? 0) / 12 / 100;
  const installment = terms.installment!;
  const months = Math.min(600, Math.round(terms.tenureMonths!));
  const todayKey = toDateInput(today);
  const rows: ScheduleRow[] = [];
  let balance = terms.originalAmount;
  let cumulative = 0;
  let warning: string | null = null;

  for (let n = 1; n <= months && balance > 0.005; n++) {
    const interest = round2(balance * monthly);
    if (installment <= interest) {
      warning = "The instalment does not cover the monthly interest, so the loan never reduces. Check the rate and instalment.";
      break;
    }
    // The last instalment is whatever clears the balance.
    const principal = round2(Math.min(balance, installment - interest));
    balance = round2(balance - principal);
    cumulative = round2(cumulative + principal);
    const dueDate = addMonthsToDay(terms.date, n);
    const status: ScheduleRow["status"] = cumulative <= principalPaid + 0.5 ? "covered" : dueDate < todayKey ? "due" : "upcoming";
    rows.push({ n, dueDate, installment: round2(principal + interest), interest, principal, balance, status });
  }
  if (!warning && balance > 0.5) {
    warning = `At this instalment the loan is not repaid within ${months} months: about ${Math.round(balance).toLocaleString("en-IN")} rupees of principal would remain.`;
  }
  return {
    rows,
    totalInterest: round2(rows.reduce((s, r) => s + r.interest, 0)),
    interestRemaining: round2(rows.filter((r) => r.status !== "covered").reduce((s, r) => s + r.interest, 0)),
    next: rows.find((r) => r.status !== "covered") ?? null,
    warning,
  };
}

/** The usual EMI for an amount, yearly rate and tenure, offered as a suggestion in the form. */
export function suggestedEmi(amount: number, ratePercent: number, months: number): number | null {
  if (!(amount > 0) || !(months > 0) || !(ratePercent >= 0)) return null;
  const r = ratePercent / 12 / 100;
  if (r === 0) return round2(amount / months);
  const f = Math.pow(1 + r, months);
  return round2((amount * r * f) / (f - 1));
}
