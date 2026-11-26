/**
 * Which recurring schedules are fixed commitments (Fixed payments). Client-safe, so the schedule
 * form and the Fixed payments page apply one rule.
 *
 * A schedule's own `fixed` flag wins. When it was never set (every schedule saved before the flag
 * existed), rent counts as fixed. This is a display rule only: nothing is written to old schedules.
 */

/** Categories treated as fixed commitments when a schedule has no flag of its own. */
export const FIXED_BY_DEFAULT_CATEGORIES: readonly string[] = ["rent"];

export function isFixedCommitment(schedule: { fixed?: boolean | null; category?: string | null }): boolean {
  if (typeof schedule.fixed === "boolean") return schedule.fixed;
  return FIXED_BY_DEFAULT_CATEGORIES.includes(schedule.category ?? "");
}

/** Mongo condition for the same rule, for queries over recurringExpenses. */
export function fixedCommitmentFilter(): Record<string, unknown> {
  // `fixed: null` matches a missing flag too.
  return { $or: [{ fixed: true }, { fixed: null, category: { $in: [...FIXED_BY_DEFAULT_CATEGORIES] } }] };
}
