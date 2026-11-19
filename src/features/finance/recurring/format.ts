import type { RecurringFrequency, RecurringStatus } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";

/** Wording helpers for recurring schedules. Client-safe. */

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "Monthly on the 5th", "Monthly on the last day", "Quarterly on the 10th", "Weekly on Mondays". */
export function rhythmLabel(frequency: RecurringFrequency, dayOfMonth: number, startDate?: string | Date | null): string {
  if (frequency === "weekly") {
    const day = startDate ? new Date(`${toDateInput(startDate)}T00:00:00Z`).getUTCDay() : null;
    return day === null ? "Every week" : `Weekly on ${WEEKDAYS[day]}`;
  }
  const lead = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Every 6 months", yearly: "Yearly" }[frequency];
  return `${lead} on ${dayOfMonth >= 31 ? "the last day" : `the ${ordinal(dayOfMonth)}`}`;
}

/** Whole days from today (IST) to a due date: negative when it is past. */
export function daysUntil(due: string | Date, now: Date = new Date()): number {
  const a = new Date(`${toDateInput(due)}T00:00:00Z`).getTime();
  const b = new Date(`${toDateInput(now)}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

export type DueInfo = { label: string; tone: "today" | "overdue" | "soon" | "later" | "idle" };

/** "Due today", "Tomorrow", "In 12 days", "3 days overdue". Paused and ended schedules have no due label. */
export function dueInfo(due: string, status: RecurringStatus, now: Date = new Date()): DueInfo {
  if (status === "ended") return { label: "Ended", tone: "idle" };
  const days = daysUntil(due, now);
  if (status === "paused") return { label: "Paused", tone: "idle" };
  if (days < 0) return { label: `${-days} day${days === -1 ? "" : "s"} overdue`, tone: "overdue" };
  if (days === 0) return { label: "Due today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days <= 45) return { label: `In ${days} days`, tone: days <= 7 ? "soon" : "later" };
  return { label: `In ${Math.round(days / 30)} months`, tone: "later" };
}
