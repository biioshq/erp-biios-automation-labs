import { startOfDayIST } from "@/lib/dates";

/** Budget health: warning from 80% of the budget, danger above 100%. Client-safe. */
export function budgetTone(usage: number, budget: number): "ok" | "warning" | "danger" {
  if (budget <= 0) return "ok";
  if (usage > 1) return "danger";
  if (usage >= 0.8) return "warning";
  return "ok";
}

export const BUDGET_BAR_CLASS = { ok: "bg-info", warning: "bg-warning", danger: "bg-danger" } as const;
export const BUDGET_TEXT_CLASS = { ok: "text-muted-foreground", warning: "text-warning", danger: "text-danger" } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today (IST) to a date. Negative when the date has passed. */
export function daysUntil(date: string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  return Math.round((startOfDayIST(new Date(date)).getTime() - startOfDayIST(now).getTime()) / DAY_MS);
}

/** "12 days left", "Ends today", "3 days overdue". */
export function deadlineLabel(endDate: string | null, status: string, now: Date = new Date()) {
  const days = daysUntil(endDate, now);
  if (days === null) return null;
  const done = status === "completed" || status === "cancelled";
  if (days === 0) return { text: "Ends today", late: false };
  if (days > 0) return { text: `${days} day${days === 1 ? "" : "s"} left`, late: false };
  return done ? { text: "Ended", late: false } : { text: `${-days} day${days === -1 ? "" : "s"} overdue`, late: true };
}

/** Share of the project's time window that has passed, 0 to 1. Null when dates are missing. */
export function timeElapsed(start: string | null, end: string | null, now: Date = new Date()): number | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (e <= s) return null;
  return Math.min(1, Math.max(0, (now.getTime() - s) / (e - s)));
}
