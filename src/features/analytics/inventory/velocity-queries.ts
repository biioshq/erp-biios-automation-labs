import "server-only";

import { itemPositions, usageByItem } from "@/server/analytics/core";
import { round2 } from "@/lib/format";
import type { AnalyticsRange } from "./params";
import { firstMovementDays, lastIssueDays, loadMovements, round3 } from "./data";

/**
 * Fast, slow and non-moving materials (4.2). The rule, as the page states it:
 *  - Consumption is the shared measure (src/server/analytics/core.ts): units issued to projects
 *    less units returned, over the period.
 *  - Issues are stock assignments to projects; moves between projects are not counted as issues.
 *  - Among items issued at least once in the period, each gets two ranks: issues per month, and
 *    the share of its stock used (units consumed / (units consumed + units in storage now)).
 *    The average of the two ranks orders them; the top third is fast-moving, the middle third
 *    steady and the bottom third slow-moving. Fewer than MIN_RANKED items are not split.
 *  - Non-moving: active items with stock in storage and no issue in the period. Items first
 *    recorded during the period are counted apart: they have not been held the whole period.
 *  - No movement: active items with no movement of any kind in the period.
 */

export const MIN_RANKED = 3;
const DAYS_PER_MONTH = 30.44;

export type VelocityClass = "fast" | "steady" | "slow";

export type VelocityRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  categoryName: string | null;
  available: number;
  value: number;
  issues: number;
  issuesPerMonth: number;
  consumed: number;
  /** consumed / (consumed + available); 0 to 1. */
  shareUsed: number;
  purchases: number;
  purchasedQty: number;
  movements: number;
  lastIssue: string | null;
  firstRecorded: string | null;
  velocity: VelocityClass | null;
};

export type VelocityData = {
  rows: VelocityRow[];
  ranked: boolean;
  fast: VelocityRow[];
  steady: VelocityRow[];
  slow: VelocityRow[];
  nonMoving: VelocityRow[];
  nonMovingValue: number;
  /** Items with stock and no issue that were first recorded during the period (not judged). */
  addedDuringPeriod: number;
  noStockNoIssue: number;
  noMovement: VelocityRow[];
  frequentlyPurchased: VelocityRow[];
  frequentlyConsumed: VelocityRow[];
  itemCount: number;
};

/** Percentile rank (0 to 1) of each value among `values`; ties share the average rank. */
function percentRanks(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 1);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const below = sorted.filter((x) => x < v).length;
    const equal = sorted.filter((x) => x === v).length;
    return (below + (equal - 1) / 2) / (values.length - 1);
  });
}

/** Splits moving items into thirds by the combined rank (see the header). Exported for tests. */
export function classify<T extends { issuesPerMonth: number; shareUsed: number }>(rows: T[]): Map<T, VelocityClass> {
  const out = new Map<T, VelocityClass>();
  if (rows.length < MIN_RANKED) return out;
  const a = percentRanks(rows.map((r) => r.issuesPerMonth));
  const b = percentRanks(rows.map((r) => r.shareUsed));
  const scored = rows.map((r, i) => ({ r, score: (a[i] + b[i]) / 2 })).sort((x, y) => y.score - x.score);
  const n = scored.length;
  scored.forEach(({ r }, i) => out.set(r, i < Math.round(n / 3) ? "fast" : i < Math.round((2 * n) / 3) ? "steady" : "slow"));
  return out;
}

export async function getVelocity(range: AnalyticsRange): Promise<VelocityData> {
  const [items, usage, rows, lastIssue, firstSeen] = await Promise.all([
    itemPositions(),
    usageByItem(range.days, range.end),
    loadMovements(range.start, range.end),
    lastIssueDays(),
    firstMovementDays(),
  ]);
  const counts = new Map<string, { issues: number; purchases: number; purchasedQty: number; movements: number }>();
  for (const m of rows) {
    const c = counts.get(m.item) ?? { issues: 0, purchases: 0, purchasedQty: 0, movements: 0 };
    c.movements += 1;
    if (m.type === "assign" && !m.moveHalf) c.issues += 1;
    if (m.type === "purchase" && !m.openingOnHand) {
      c.purchases += 1;
      c.purchasedQty = round3(c.purchasedQty + m.quantity);
    }
    counts.set(m.item, c);
  }
  const months = range.days / DAYS_PER_MONTH;
  const all: VelocityRow[] = items.map((i) => {
    const c = counts.get(i.id) ?? { issues: 0, purchases: 0, purchasedQty: 0, movements: 0 };
    const consumed = usage.get(i.id)?.consumed ?? 0;
    const base = consumed + Math.max(0, i.available);
    return {
      id: i.id,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      categoryName: i.categoryName,
      available: i.available,
      value: i.value,
      issues: c.issues,
      issuesPerMonth: Math.round((c.issues / months) * 100) / 100,
      consumed,
      shareUsed: base > 0 ? consumed / base : 0,
      purchases: c.purchases,
      purchasedQty: c.purchasedQty,
      movements: c.movements,
      lastIssue: lastIssue.get(i.id) ?? null,
      firstRecorded: firstSeen.get(i.id) ?? null,
      velocity: null,
    };
  });
  const moving = all.filter((r) => r.issues > 0);
  const classes = classify(moving);
  for (const r of moving) r.velocity = classes.get(r) ?? null;
  const byScore = (a: VelocityRow, b: VelocityRow) => b.issuesPerMonth - a.issuesPerMonth || b.shareUsed - a.shareUsed;
  const addedLate = (r: VelocityRow) => r.firstRecorded !== null && r.firstRecorded > range.from;
  const idle = all.filter((r) => r.issues === 0 && r.available > 0);
  const nonMoving = idle.filter((r) => !addedLate(r)).sort((a, b) => b.value - a.value);
  return {
    rows: all,
    ranked: classes.size > 0,
    fast: moving.filter((r) => r.velocity === "fast").sort(byScore),
    steady: moving.filter((r) => r.velocity === "steady").sort(byScore),
    slow: moving.filter((r) => r.velocity === "slow").sort(byScore),
    nonMoving,
    nonMovingValue: round2(nonMoving.reduce((s, r) => s + r.value, 0)),
    addedDuringPeriod: idle.filter(addedLate).length,
    noStockNoIssue: all.filter((r) => r.issues === 0 && r.available <= 0).length,
    noMovement: all.filter((r) => r.movements === 0).sort((a, b) => b.value - a.value),
    frequentlyPurchased: all
      .filter((r) => r.purchases > 0)
      .sort((a, b) => b.purchases - a.purchases || b.purchasedQty - a.purchasedQty)
      .slice(0, 10),
    frequentlyConsumed: [...moving].sort((a, b) => b.issues - a.issues || b.consumed - a.consumed).slice(0, 10),
    itemCount: all.length,
  };
}
