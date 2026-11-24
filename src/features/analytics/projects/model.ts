import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/constants";
import { firstParam } from "@/features/analytics/inventory/params";
import type { SearchParams } from "@/lib/list-params";

/**
 * Pure rules of the project analytics pages. Client-safe, no database access, so they are easy
 * to test and the pages state exactly the rule they apply. Cost types and the original budget come
 * from src/lib/project-cost-types.ts and the cost forecast from ../project-forecast.ts, both shared
 * with the finance and forecasting pages.
 */

export const CLOSED_STATUSES: ProjectStatus[] = ["completed", "cancelled"];
export const isClosed = (status: string) => (CLOSED_STATUSES as string[]).includes(status);

/**
 * The budget in force at an instant. Each history entry is a budget the project had until
 * `changedAt`; after the last change the current budget applies.
 */
export function budgetAt(at: Date, budget: number, history: { budget: number; changedAt: Date | string }[] | null | undefined): number {
  for (const h of history ?? []) if (at.getTime() < new Date(h.changedAt).getTime()) return h.budget;
  return budget;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The day the budget would be used up at the current spend rate (start + elapsed × budget / spent).
 * Null when there is no budget, no spend, or the project has not started.
 */
export function budgetExhaustionDay(p: { startDate: string | null; budget: number; spent: number }, today: string): string | null {
  if (!p.startDate || p.budget <= 0 || p.spent <= 0 || p.startDate > today) return null;
  const elapsed = Math.round((fromDateInput(today).getTime() - fromDateInput(p.startDate).getTime()) / DAY_MS) + 1;
  return toDateInput(addDays(fromDateInput(p.startDate), Math.round((elapsed * p.budget) / p.spent)));
}

/** Status filter from ?status=: a comma list of statuses; empty means every status. */
export function statusesParam(sp: SearchParams): ProjectStatus[] | null {
  const valid = new Set<string>(PROJECT_STATUSES.map((s) => s.value));
  const list = firstParam(sp.status)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => valid.has(s)) as ProjectStatus[];
  return list.length ? list : null;
}

export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "planning,active,on_hold", label: "Open (planning, active, on hold)" },
  { value: "completed,cancelled", label: "Closed (completed, cancelled)" },
  ...PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
];

/** The select value for the current filter (a known option, or all). */
export function statusFilterValue(statuses: ProjectStatus[] | null): string {
  if (!statuses) return "all";
  const joined = statuses.join(",");
  return STATUS_FILTER_OPTIONS.some((o) => o.value === joined) ? joined : "all";
}

/** Adds up a money field over rows, to the paisa. */
export const sumOf = <T>(rows: T[], pick: (r: T) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));

/**
 * Budget used over the projects that have a budget: their spend divided by their budgets.
 * Projects without a budget are left out (and counted), so the share never mixes spend that has
 * no budget to measure against. The dashboard card and Budget vs actual both use this.
 */
export function budgetUse(rows: { budget: number; spent: number }[]) {
  const withBudget = rows.filter((r) => r.budget > 0);
  const budget = sumOf(withBudget, (r) => r.budget);
  const spent = sumOf(withBudget, (r) => r.spent);
  return { budget, spent, usage: budget > 0 ? spent / budget : null, projects: withBudget.length, withoutBudget: rows.length - withBudget.length };
}

export type BudgetUse = ReturnType<typeof budgetUse>;

export const BUDGET_USE_RULE = "Spend of the projects that have a budget, divided by the sum of their budgets. Projects without a budget are left out.";
