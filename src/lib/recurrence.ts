import type { RecurringFrequency } from "./constants";
import { fromDateInput, toDateInput } from "./dates";

/**
 * Due-date maths for recurring expenses, on IST calendar days. Client-safe so
 * forms can preview the schedule ("Next: 1 Dec 2026, then 1 Jan 2027").
 */

const MONTHS_PER: Record<Exclude<RecurringFrequency, "weekly">, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

function daysInMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The date in year/month at `dayOfMonth`, clamped to the month's last day (31 = always the last day). */
function onDay(year: number, month1: number, dayOfMonth: number): Date {
  const d = Math.min(dayOfMonth, daysInMonth(year, month1));
  return fromDateInput(`${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
}

/** The first due date on or after `start`. */
export function firstOccurrence(start: Date, frequency: RecurringFrequency, dayOfMonth: number): Date {
  const startDay = toDateInput(start);
  if (frequency === "weekly") return fromDateInput(startDay);
  const [y, m] = startDay.split("-").map(Number);
  const candidate = onDay(y, m, dayOfMonth);
  if (toDateInput(candidate) >= startDay) return candidate;
  const next = new Date(Date.UTC(y, m - 1 + 1, 1));
  return onDay(next.getUTCFullYear(), next.getUTCMonth() + 1, dayOfMonth);
}

/** The due date after `current`. */
export function nextOccurrence(current: Date, frequency: RecurringFrequency, dayOfMonth: number): Date {
  const day = toDateInput(current);
  if (frequency === "weekly") {
    const [y, m, d] = day.split("-").map(Number);
    return fromDateInput(new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10));
  }
  const [y, m] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + MONTHS_PER[frequency], 1));
  return onDay(target.getUTCFullYear(), target.getUTCMonth() + 1, dayOfMonth);
}

/** The next `count` due dates from `from` (inclusive), stopping at `end`. */
export function upcomingOccurrences(
  from: Date,
  frequency: RecurringFrequency,
  dayOfMonth: number,
  count: number,
  end?: Date | null,
): Date[] {
  const out: Date[] = [];
  let d = from;
  while (out.length < count && (!end || d.getTime() <= end.getTime())) {
    out.push(d);
    d = nextOccurrence(d, frequency, dayOfMonth);
  }
  return out;
}

/** Monthly-equivalent cost, for "₹X a month" summaries. */
export function monthlyEquivalent(amount: number, frequency: RecurringFrequency): number {
  if (frequency === "weekly") return (amount * 52) / 12;
  return amount / MONTHS_PER[frequency];
}

/** "Nov 2026" or "Week of 19 Nov 2026" for an occurrence's description. */
export function periodLabel(date: Date, frequency: RecurringFrequency): string {
  const fmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  if (frequency === "weekly") {
    const d = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    return `Week of ${d.format(date)}`;
  }
  return fmt.format(date);
}
