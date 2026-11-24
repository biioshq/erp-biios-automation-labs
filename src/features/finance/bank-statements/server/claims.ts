/**
 * A claimed line with no record after this long was interrupted; the next add may finish it.
 * Shared by the add (commit.ts), the review (review.ts) and the statement page (queries.ts).
 */
export const STALE_CLAIM_MS = 5 * 60_000;

/**
 * True when a line with no link is free to be reviewed and added again: it was unmatched (it
 * carries unmatchedAt, cleared again when an add claims it), or its add was cut off long ago.
 * Lines unmatched before unmatchedAt existed had their time set back past the claim window, so
 * the time check still covers them.
 */
export function isReopenable(t: { action: string; unmatchedAt?: Date | null; updatedAt: Date }, now = Date.now()): boolean {
  if (t.action === "ignore") return false;
  return Boolean(t.unmatchedAt) || t.updatedAt.getTime() < now - STALE_CLAIM_MS;
}

/** The same rule as a query filter, for the guarded reclaim of a line with no link. */
export function reopenableFilter(now = Date.now()) {
  return { $or: [{ unmatchedAt: { $exists: true } }, { updatedAt: { $lt: new Date(now - STALE_CLAIM_MS) } }] };
}
