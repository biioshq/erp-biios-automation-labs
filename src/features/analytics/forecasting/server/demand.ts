import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryAllocation, InventoryItem, InventoryMovement } from "@/server/models";
import { coverage, itemPositions, usageByItem, type ItemPosition, type ItemUsage } from "@/server/analytics/core";
import { endOfDayIST, fromDateInput, toDateInput } from "@/lib/dates";
import { HORIZONS, MIN_HISTORY_DAYS, MIN_MOVEMENTS, OVERSTOCK_DAYS, SNAPSHOT_HORIZON_DAYS, type Horizon } from "../constants";
import { dayCount, type ForecastFilters, type HistoryWindow } from "../params";
import type { DemandRow } from "../types";

/**
 * The material demand forecast every forecasting page reads (demand, purchases, consumption and
 * the stored monthly snapshot), so a rate and the "enough history" decision are made one way.
 * Units used come from the shared analytics core (usageByItem); this adds the history check and
 * the rate: units used in the window ÷ days from the first assignment in the window to its end (rateDays).
 * With a project filter, everything is that project's own: units, use count, history and rate.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

const emptyUsage = (id: string): ItemUsage => ({
  itemId: id,
  issued: 0,
  returned: 0,
  consumed: 0,
  wasted: 0,
  perDay: null,
  firstUse: null,
  lastUse: null,
  movements: 0,
});

/** The first recorded movement of each item up to `asOf`; with a project, its first movement on that project. */
export async function firstMovementByItem(asOf: Date, projectId?: string | null): Promise<Map<string, Date>> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; first: Date }>([
    { $match: { date: { $lte: asOf }, ...(projectId ? { project: new Types.ObjectId(projectId) } : {}) } },
    { $group: { _id: "$item", first: { $min: "$date" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.first]));
}

export type UseEvents = { n: number; first: Date };

/**
 * Assignments and returns per item in the window (with a project, on that project only), and the
 * first of them. The history rule counts these use events only: purchases, adjustments and
 * location moves say nothing about how fast stock is used.
 */
export async function assignReturnCountByItem(from: Date, to: Date, projectId?: string | null): Promise<Map<string, UseEvents>> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; n: number; first: Date }>([
    { $match: { date: { $gte: from, $lte: to }, type: { $in: ["assign", "return"] }, ...(projectId ? { project: new Types.ObjectId(projectId) } : {}) } },
    { $group: { _id: "$item", n: { $sum: 1 }, first: { $min: "$date" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { n: r.n, first: r.first }]));
}

/**
 * Days a material's use in the window is spread over: from its first assignment in the window
 * (usageByItem's firstUse, "yyyy-mm-dd" IST) to the window's end, both included, never fewer than
 * MIN_HISTORY_DAYS and never more than the window. A material first used partway through the window
 * is not diluted over days before it was used. A move between projects is not a first use company
 * wide (the stock never left a project), as in usageByItem; with a project picked, stock moved in
 * is that project's first use.
 */
export function rateDays(window: Pick<HistoryWindow, "to" | "days">, firstUse: string | null | undefined): number {
  if (!firstUse) return window.days;
  const span = dayCount(firstUse, window.to);
  return Math.min(window.days, Math.max(MIN_HISTORY_DAYS, span));
}

/**
 * Units in use on projects per item: open assignments less units wasted there, as Inventory counts
 * stock in use. Units wasted on a project stay in the item's `allocated` but are no longer in use.
 */
export async function inUseByItem(): Promise<Map<string, number>> {
  await connectDB();
  const rows = await InventoryAllocation.aggregate<{ _id: Types.ObjectId; units: number }>([
    { $match: { quantity: { $gt: 0 } } },
    { $group: { _id: "$item", units: { $sum: { $max: [0, { $subtract: ["$quantity", { $ifNull: ["$quantityWasted", 0] }] }] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), round3(r.units)]));
}

/**
 * Items a project has used (any movement with that project, ever), with what it consumed in the
 * window (assigned less returned), so the project filter can narrow the list.
 */
export async function projectItemUse(projectId: string, from: Date, to: Date): Promise<Map<string, number>> {
  await connectDB();
  const inWindow = { $and: [{ $gte: ["$date", from] }, { $lte: ["$date", to] }] };
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; assigned: number; returned: number }>([
    { $match: { project: new Types.ObjectId(projectId) } },
    {
      $group: {
        _id: "$item",
        assigned: { $sum: { $cond: [{ $and: [inWindow, { $eq: ["$type", "assign"] }] }, "$quantity", 0] } },
        returned: { $sum: { $cond: [{ $and: [inWindow, { $eq: ["$type", "return"] }] }, "$quantity", 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), round3(Math.max(0, r.assigned - r.returned))]));
}

/** Last purchase price per item, for purchase cost estimates (not part of the shared positions). */
export async function lastPurchasePrices(): Promise<Map<string, number>> {
  await connectDB();
  const rows = await InventoryItem.find({ archivedAt: null, lastPurchasePrice: { $gt: 0 } }, { lastPurchasePrice: 1 }).lean();
  return new Map(rows.map((r) => [String(r._id), r.lastPurchasePrice ?? 0]));
}

type Judged = Pick<DemandRow, "status" | "reason" | "historyDays">;

/** Whether an item has enough recorded history to be forecast, and why not. `onProject`: judged on one project's own movements. */
function judgeHistory(usage: ItemUsage, useMovements: number, first: Date | undefined, windowEnd: Date, onProject: boolean): Judged {
  const where = onProject ? " on this project" : "";
  if (!first) return { status: "insufficient", reason: onProject ? "Not used on this project yet" : "No stock movements recorded", historyDays: null };
  const historyDays = Math.floor((windowEnd.getTime() - first.getTime()) / DAY_MS) + 1;
  if (historyDays < MIN_HISTORY_DAYS) {
    const span = `${historyDays} ${historyDays === 1 ? "day" : "days"}`;
    return { status: "insufficient", reason: onProject ? `Used on this project for ${span} (${MIN_HISTORY_DAYS} needed)` : `Recorded for ${span} (${MIN_HISTORY_DAYS} needed)`, historyDays };
  }
  if (!usage.perDay) return { status: "no_use", reason: `No use recorded${where} in the window`, historyDays };
  if (useMovements < MIN_MOVEMENTS) {
    return {
      status: "insufficient",
      reason: `${useMovements} ${useMovements === 1 ? "assignment or return" : "assignments or returns"}${where} in the window (${MIN_MOVEMENTS} needed)`,
      historyDays,
    };
  }
  return { status: "forecast", reason: null, historyDays };
}

type ItemFacts = { usage: ItemUsage; useMovements: number; inUse: number; first: Date | undefined };

function buildRow(item: ItemPosition, facts: ItemFacts, window: HistoryWindow, windowEnd: Date, now: Date, onProject: boolean): DemandRow {
  const { usage, useMovements, inUse, first } = facts;
  const judged = judgeHistory(usage, useMovements, first, windowEnd, onProject);
  // The rate spreads the window's use over the days since its first assignment in the window (rateDays),
  // not over the whole window (usageByItem's perDay), so late starters are not diluted.
  const spread = judged.status === "forecast" ? rateDays(window, usage.firstUse) : null;
  const rate = spread !== null && usage.consumed > 0 ? usage.consumed / spread : null;
  // Coverage always runs from today: the window may end in the past, the stock on hand is today's.
  const cover = coverage(item.available, rate, item.leadTimeDays, now);
  const predicted = rate ? (Object.fromEntries(HORIZONS.map((h) => [h, round3(rate * h)])) as Record<Horizon, number>) : null;
  let overstock: string | null = null;
  if (cover.daysOfCover !== null && cover.daysOfCover > OVERSTOCK_DAYS) overstock = `Lasts about ${Math.floor(cover.daysOfCover)} days at the recent rate`;
  else if (judged.status === "no_use" && item.available > 0) overstock = "In stock with no use in the window";
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    categoryId: item.category,
    categoryName: item.categoryName,
    available: item.available,
    allocated: inUse,
    minStock: item.minStock,
    leadTimeDays: item.leadTimeDays,
    unitPrice: item.unitPrice,
    value: item.value,
    stockStatus: item.status,
    issued: usage.issued,
    returned: usage.returned,
    consumed: usage.consumed,
    wasted: usage.wasted,
    movements: usage.movements,
    useMovements,
    perDay: rate,
    rateDays: spread,
    firstMovement: first ? toDateInput(first) : null,
    ...judged,
    predicted,
    daysOfCover: cover.daysOfCover,
    stockoutDate: cover.stockoutDate,
    orderBy: cover.orderBy,
    extraNeeded: rate ? Math.max(0, Math.ceil(round3(rate * SNAPSHOT_HORIZON_DAYS - item.available))) : null,
    overstock,
    projectConsumed: null,
  };
}

export type DemandForecast = {
  rows: DemandRow[];
  /** Rows before the item, category and project filters (for option counts and totals). */
  totalItems: number;
};

/** The demand forecast for every active item over the window, narrowed by the filters. */
export async function demandForecast(window: HistoryWindow, filters: ForecastFilters = { item: null, category: null, project: null }, now: Date = new Date()): Promise<DemandForecast> {
  const windowEnd = endOfDayIST(fromDateInput(window.to));
  const windowStart = fromDateInput(window.from);
  // With a project picked, rates, use counts and history are that project's own.
  const [items, usage, useEvents, inUse, firsts, projectUse] = await Promise.all([
    itemPositions(),
    usageByItem(window.days, windowEnd, undefined, filters.project ?? undefined),
    assignReturnCountByItem(windowStart, windowEnd, filters.project),
    inUseByItem(),
    firstMovementByItem(windowEnd, filters.project),
    filters.project ? projectItemUse(filters.project, windowStart, windowEnd) : Promise.resolve(null),
  ]);
  const rows: DemandRow[] = [];
  for (const item of items) {
    if (filters.item && item.id !== filters.item) continue;
    if (filters.category && item.category !== filters.category) continue;
    if (projectUse && !projectUse.has(item.id)) continue;
    const facts: ItemFacts = {
      usage: usage.get(item.id) ?? emptyUsage(item.id),
      useMovements: useEvents.get(item.id)?.n ?? 0,
      inUse: inUse.get(item.id) ?? 0,
      first: firsts.get(item.id),
    };
    const row = buildRow(item, facts, window, windowEnd, now, Boolean(filters.project));
    if (projectUse) row.projectConsumed = projectUse.get(item.id) ?? 0;
    rows.push(row);
  }
  return { rows, totalItems: items.length };
}
