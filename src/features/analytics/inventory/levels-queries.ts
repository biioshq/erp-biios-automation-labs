import "server-only";

import { ALERT_BUFFER_DAYS, coverage, itemPositions, usageByItem, type Coverage, type ItemPosition } from "@/server/analytics/core";
import { addDays, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { firstMovementDays, lastIssueDays, loadMovements, round3 } from "./data";

/**
 * Overstock and understock (4.4). Every rate, cover and stockout date comes from the shared
 * analytics core, so this page agrees with the inventory alerts. The rules:
 *  - Excess: stock lasts longer than the chosen number of days at the recent rate of use, or
 *    stock above the minimum level that was not used at all in the window.
 *  - Items first recorded inside the window are not judged on "no use": the window says little
 *    about stock entered last week. They are counted separately.
 *  - Below minimum: available at or under the item's minimum level (items with a minimum set).
 *  - Below reorder level: the reorder level is not recorded separately; it is the minimum plus
 *    the use expected during the lead time (rate x lead time). Without a recorded lead time it
 *    equals the minimum, so those items already show under "below minimum".
 *  - Insufficient cover: runs out within its lead time plus a week, as the alerts use.
 *  - No recent consumption: stock in storage with nothing used in the window.
 *  - Bought more than used: purchased in the window, and less than half of that used in it.
 */

export const LOW_USE_SHARE = 0.5;

export type LevelRow = ItemPosition &
  Coverage & {
    consumed: number;
    perDay: number | null;
    purchasedQty: number;
    lastIssue: string | null;
    firstRecorded: string | null;
    /** First recorded inside the window, so "no use in the window" is not meaningful yet. */
    recent: boolean;
    reorderLevel: number | null;
    excessQty: number;
    excessValue: number;
    excessReason: "cover" | "idle" | null;
  };

export type LevelsData = {
  excess: LevelRow[];
  excessValue: number;
  belowMinimum: LevelRow[];
  belowReorder: LevelRow[];
  noLeadTime: number;
  insufficient: LevelRow[];
  idle: LevelRow[];
  idleValue: number;
  /** Items with stock and no use, first recorded inside the window (not judged). */
  recentlyAdded: number;
  overbought: LevelRow[];
  itemCount: number;
  withMinimum: number;
};

/** The reorder level when it can be worked out from the minimum, the rate and the lead time. */
export function reorderLevelOf(minStock: number, perDay: number | null, leadTimeDays: number | null): number | null {
  if (leadTimeDays === null || !perDay) return null;
  return round3(minStock + perDay * leadTimeDays);
}

export async function getLevels(windowDays: number, coverDays: number, now: Date = new Date()): Promise<LevelsData> {
  const start = startOfDayIST(addDays(now, -windowDays + 1));
  const [items, usage, rows, lastIssue, firstSeen] = await Promise.all([
    itemPositions(),
    usageByItem(windowDays, now),
    loadMovements(start, now),
    lastIssueDays(),
    firstMovementDays(),
  ]);
  const startDay = toDateInput(start);
  const purchased = new Map<string, number>();
  for (const m of rows) if (m.type === "purchase" && !m.openingOnHand) purchased.set(m.item, round3((purchased.get(m.item) ?? 0) + m.quantity));

  const all: LevelRow[] = items.map((i) => {
    const u = usage.get(i.id);
    const perDay = u?.perDay ?? null;
    const c = coverage(i.available, perDay, i.leadTimeDays, now);
    const firstRecorded = firstSeen.get(i.id) ?? null;
    const recent = firstRecorded !== null && firstRecorded > startDay;
    let excessQty = 0;
    let excessReason: LevelRow["excessReason"] = null;
    if (c.daysOfCover !== null && c.daysOfCover > coverDays && perDay) {
      excessQty = round3(i.available - perDay * coverDays);
      excessReason = "cover";
    } else if (!perDay && !recent && i.available > i.minStock) {
      excessQty = round3(i.available - i.minStock);
      excessReason = "idle";
    }
    return {
      ...i,
      ...c,
      consumed: u?.consumed ?? 0,
      perDay,
      purchasedQty: purchased.get(i.id) ?? 0,
      lastIssue: lastIssue.get(i.id) ?? null,
      firstRecorded,
      recent,
      reorderLevel: reorderLevelOf(i.minStock, perDay, i.leadTimeDays),
      excessQty,
      excessValue: round2(excessQty * i.unitPrice),
      excessReason,
    };
  });

  const excess = all.filter((r) => r.excessQty > 0).sort((a, b) => b.excessValue - a.excessValue);
  const belowMinimum = all.filter((r) => r.minStock > 0 && r.available <= r.minStock).sort((a, b) => a.available / a.minStock - b.available / b.minStock);
  const belowReorder = all
    .filter((r) => r.reorderLevel !== null && r.available <= r.reorderLevel && !(r.minStock > 0 && r.available <= r.minStock))
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const insufficient = all
    .filter((r) => r.daysOfCover !== null && r.available > 0 && r.daysOfCover <= (r.leadTimeDays ?? 0) + ALERT_BUFFER_DAYS)
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const idle = all.filter((r) => r.available > 0 && !r.perDay && !r.recent).sort((a, b) => b.value - a.value);
  const overbought = all
    .filter((r) => r.purchasedQty > 0 && r.consumed < r.purchasedQty * LOW_USE_SHARE)
    .sort((a, b) => b.purchasedQty * b.unitPrice - a.purchasedQty * a.unitPrice);
  return {
    excess,
    excessValue: round2(excess.reduce((s, r) => s + r.excessValue, 0)),
    belowMinimum,
    belowReorder,
    noLeadTime: all.filter((r) => r.leadTimeDays === null).length,
    insufficient,
    idle,
    idleValue: round2(idle.reduce((s, r) => s + r.value, 0)),
    recentlyAdded: all.filter((r) => r.available > 0 && !r.perDay && r.recent).length,
    overbought,
    itemCount: all.length,
    withMinimum: all.filter((r) => r.minStock > 0).length,
  };
}
