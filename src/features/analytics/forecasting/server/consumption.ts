import "server-only";

import { usageByItem, type ItemUsage } from "@/server/analytics/core";
import { addDays, endOfDayIST, fromDateInput, startOfDayIST, startOfMonthIST } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { SNAPSHOT_HORIZON_DAYS, UNUSUAL_MIN_UNITS, UNUSUAL_PRIOR_DAYS, UNUSUAL_RATIO, UNUSUAL_RECENT_DAYS } from "../constants";
import type { ForecastFilters, HistoryWindow } from "../params";
import type { ConsumptionRow, DemandRow, MonthPoint, UnusualChange } from "../types";
import { demandForecast } from "./demand";
import { monthlyMovements, wastageByItem, type ItemWastage } from "./history";

/**
 * Material consumption: averages over the history window, the last four weeks against the four
 * before, unusual changes, wastage and adjustments. All of it from the shared usage measure.
 *
 * Unusual change rule: the daily rate over the last 30 days is more than 50% above or below the
 * daily rate over the 90 days before them, the item moved at least 5 units across both periods,
 * and it has been recorded for the whole 120 days (so a new item does not look like a jump).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function unusualChange(recent: number, prior: number, firstMovement: string | null, now: Date, unit: string): UnusualChange | null {
  if (!firstMovement) return null;
  const span = Math.floor((startOfDayIST(now).getTime() - fromDateInput(firstMovement).getTime()) / DAY_MS) + 1;
  if (span < UNUSUAL_RECENT_DAYS + UNUSUAL_PRIOR_DAYS) return null;
  if (recent + prior < UNUSUAL_MIN_UNITS) return null;
  const recentPerDay = recent / UNUSUAL_RECENT_DAYS;
  const priorPerDay = prior / UNUSUAL_PRIOR_DAYS;
  const rates = `${formatNumber(round3(recentPerDay))} ${unit} a day in the last ${UNUSUAL_RECENT_DAYS} days against ${formatNumber(round3(priorPerDay))} in the ${UNUSUAL_PRIOR_DAYS} days before`;
  if (priorPerDay === 0) return { direction: "up", recentPerDay, priorPerDay, text: `Used again after no use in the ${UNUSUAL_PRIOR_DAYS} days before: ${rates}` };
  if (recentPerDay === 0) {
    return { direction: "down", recentPerDay, priorPerDay, text: `No use in the last ${UNUSUAL_RECENT_DAYS} days after ${formatNumber(round3(priorPerDay))} ${unit} a day in the ${UNUSUAL_PRIOR_DAYS} days before` };
  }
  const change = recentPerDay / priorPerDay - 1;
  if (change > UNUSUAL_RATIO) return { direction: "up", recentPerDay, priorPerDay, text: `Up ${Math.round(change * 100)}%: ${rates}` };
  if (change < -UNUSUAL_RATIO) return { direction: "down", recentPerDay, priorPerDay, text: `Down ${Math.round(-change * 100)}%: ${rates}` };
  return null;
}

const consumedOf = (m: Map<string, ItemUsage>, id: string) => m.get(id)?.consumed ?? 0;

function toRow(
  r: DemandRow,
  window: HistoryWindow,
  periods: { last4: Map<string, ItemUsage>; prev4: Map<string, ItemUsage>; recent: Map<string, ItemUsage>; prior: Map<string, ItemUsage> },
  wastage: Map<string, ItemWastage>,
  now: Date,
): ConsumptionRow {
  const last4Weeks = consumedOf(periods.last4, r.id);
  const prev4Weeks = consumedOf(periods.prev4, r.id);
  const w = wastage.get(r.id);
  // Units wasted on a project are inside `consumed` already, so only storage write-offs are added.
  const total = r.consumed + (w?.fromStorage ?? 0);
  return {
    id: r.id,
    name: r.name,
    sku: r.sku,
    unit: r.unit,
    categoryName: r.categoryName,
    status: r.status,
    reason: r.reason,
    consumed: r.consumed,
    measuredPerDay: r.consumed > 0 ? r.consumed / window.days : null,
    last4Weeks,
    prev4Weeks,
    trend: prev4Weeks > 0 ? last4Weeks / prev4Weeks - 1 : null,
    next30: r.predicted ? r.predicted[SNAPSHOT_HORIZON_DAYS] : null,
    unusual: unusualChange(consumedOf(periods.recent, r.id), consumedOf(periods.prior, r.id), r.firstMovement, now, r.unit),
    wasted: r.wasted,
    wastedValue: w?.value ?? 0,
    wastageShare: total > 0 && r.wasted > 0 ? Math.min(1, r.wasted / total) : null,
    available: r.available,
    daysOfCover: r.daysOfCover,
    stockoutDate: r.stockoutDate,
  };
}

export type ConsumptionOutlook = {
  rows: ConsumptionRow[];
  /** Active items before the filters. */
  totalItems: number;
  /** Last 12 months, this one included, for the scope of the filters. */
  months: MonthPoint[];
};

export async function consumptionOutlook(window: HistoryWindow, filters: ForecastFilters, now: Date = new Date()): Promise<ConsumptionOutlook> {
  const end = endOfDayIST(now);
  const windowEnd = endOfDayIST(fromDateInput(window.to));
  const { rows, totalItems } = await demandForecast(window, filters, now);
  const scoped = Boolean(filters.item || filters.category || filters.project);
  const itemIds = scoped ? rows.map((r) => r.id) : null;
  // With a project picked, every period is that project's own use, like the forecast rows.
  const project = filters.project ?? undefined;
  const [last4, prev4, recent, prior, wastage, months] = await Promise.all([
    usageByItem(28, end, itemIds ?? undefined, project),
    usageByItem(28, endOfDayIST(addDays(now, -28)), itemIds ?? undefined, project),
    usageByItem(UNUSUAL_RECENT_DAYS, end, itemIds ?? undefined, project),
    usageByItem(UNUSUAL_PRIOR_DAYS, endOfDayIST(addDays(now, -UNUSUAL_RECENT_DAYS)), itemIds ?? undefined, project),
    wastageByItem(fromDateInput(window.from), windowEnd, filters.project),
    // Twelve months to today; the project filter narrows the chart to that project's own movements.
    monthlyMovements(startOfMonthIST(now, -11), end, { itemIds: filters.item || filters.category ? itemIds : null, projectId: filters.project }),
  ]);
  return {
    rows: rows.map((r) => toRow(r, window, { last4, prev4, recent, prior }, wastage, now)),
    totalItems,
    months,
  };
}
