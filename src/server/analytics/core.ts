import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryAllocation, InventoryItem, InventoryMovement } from "@/server/models";
import { addDays, startOfDayIST, toDateInput } from "@/lib/dates";
import { getStockStatus } from "@/lib/stock-status";
import { roundQty } from "@/features/inventory/ledger/stock-cost";
import type { StockStatus } from "@/lib/constants";

/**
 * Shared measures over recorded stock movements, used by the inventory alerts and every
 * Analytics page, so a consumption rate or stockout date is computed one way everywhere.
 * Read-only. Nothing is guessed: an item with no recorded use has no rate (null), not zero.
 *
 * Consumption is stock issued to projects less what came back (assign − return), over a window
 * of recent days. Wastage is counted separately and never as consumption.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Days of history a rate is taken over by default. */
export const DEFAULT_WINDOW_DAYS = 90;
/** Alerts start this many days before an item must be ordered (its lead time). */
export const ALERT_BUFFER_DAYS = 7;

export type ItemUsage = {
  itemId: string;
  issued: number;
  returned: number;
  /** issued − returned over the window. */
  consumed: number;
  wasted: number;
  /** consumed ÷ window days; null when nothing was consumed in the window. */
  perDay: number | null;
  firstUse: string | null;
  lastUse: string | null;
  /** Movements of any kind in the window. */
  movements: number;
};

/**
 * Both halves of each move between projects in the window, by movement id. A move is stored as a
 * return from the first project with `allocation` set (the allocation the units went into) and an
 * assignment to the second, whose id is that allocation's `movement` (see moveBetweenProjects in
 * src/server/services/inventory-ledger.ts). Ordinary returns never set `allocation`.
 */
async function moveMovementIds(window: Record<string, unknown>): Promise<Types.ObjectId[]> {
  const returns = await InventoryMovement.find({ ...window, type: "return", allocation: { $ne: null } }, { allocation: 1 }).lean();
  if (!returns.length) return [];
  const allocationIds = returns.map((r) => r.allocation).filter((id): id is Types.ObjectId => Boolean(id));
  const allocations = await InventoryAllocation.find({ _id: { $in: allocationIds } }, { movement: 1 }).lean();
  return [...returns.map((r) => r._id), ...allocations.map((a) => a.movement).filter((id): id is Types.ObjectId => Boolean(id))];
}

/**
 * Issued, returned, wasted and the daily rate per item over the `days` before `asOf`.
 *
 * Stock moved from one project to another is not issued or returned (it never passed through the
 * stock room), so it does not count in issued, returned, firstUse or lastUse; consumption, which is
 * issued less returned, is the same either way. With `projectId`, only that project's movements
 * count, and a move does count: for the project it came from it is a return, for the project it
 * went to it is an issue.
 */
export async function usageByItem(
  days = DEFAULT_WINDOW_DAYS,
  asOf: Date = new Date(),
  itemIds?: string[],
  projectId?: string,
): Promise<Map<string, ItemUsage>> {
  await connectDB();
  const from = startOfDayIST(addDays(asOf, -days + 1));
  const window: Record<string, unknown> = {
    date: { $gte: from, $lte: asOf },
    ...(itemIds ? { item: { $in: itemIds.map((id) => new Types.ObjectId(id)) } } : {}),
  };
  const moves = projectId ? [] : await moveMovementIds(window);
  const rows = await InventoryMovement.aggregate<{ _id: { item: Types.ObjectId; type: string; move: boolean }; qty: number; first: Date; last: Date; n: number }>([
    { $match: { ...window, ...(projectId ? { project: new Types.ObjectId(projectId) } : {}) } },
    {
      $group: {
        _id: { item: "$item", type: "$type", move: moves.length ? { $in: ["$_id", moves] } : { $literal: false } },
        qty: { $sum: "$quantity" },
        first: { $min: "$date" },
        last: { $max: "$date" },
        n: { $sum: 1 },
      },
    },
  ]);
  const out = new Map<string, ItemUsage>();
  for (const r of rows) {
    const id = String(r._id.item);
    const u = out.get(id) ?? { itemId: id, issued: 0, returned: 0, consumed: 0, wasted: 0, perDay: null, firstUse: null, lastUse: null, movements: 0 };
    u.movements += r.n;
    out.set(id, u);
    if (r._id.move) continue;
    if (r._id.type === "assign") {
      u.issued += r.qty;
      u.firstUse = !u.firstUse || toDateInput(r.first) < u.firstUse ? toDateInput(r.first) : u.firstUse;
      u.lastUse = !u.lastUse || toDateInput(r.last) > u.lastUse ? toDateInput(r.last) : u.lastUse;
    } else if (r._id.type === "return") u.returned += r.qty;
    else if (r._id.type === "wastage") u.wasted += r.qty;
  }
  for (const u of out.values()) {
    u.issued = round3(u.issued);
    u.returned = round3(u.returned);
    u.wasted = round3(u.wasted);
    u.consumed = round3(Math.max(0, u.issued - u.returned));
    u.perDay = u.consumed > 0 ? u.consumed / days : null;
  }
  return out;
}

export type ItemPosition = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  categoryName: string | null;
  vendor: string | null;
  available: number;
  allocated: number;
  minStock: number;
  leadTimeDays: number | null;
  unitPrice: number;
  value: number;
  status: StockStatus;
  lastPurchaseDate: string | null;
};

/** Every active item's stock position. */
export async function itemPositions(): Promise<ItemPosition[]> {
  await connectDB();
  const items = await InventoryItem.find(
    { archivedAt: null },
    { name: 1, sku: 1, unit: 1, category: 1, vendor: 1, available: 1, allocated: 1, minStock: 1, leadTimeDays: 1, unitPrice: 1, purchaseDate: 1 },
  )
    .populate<{ category: { _id: Types.ObjectId; name: string } | null }>("category", "name")
    .lean();
  return items.map((i) => ({
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    unit: i.unit ?? "pcs",
    category: i.category?._id ? String(i.category._id) : null,
    categoryName: i.category?.name ?? null,
    vendor: i.vendor ?? null,
    available: i.available ?? 0,
    allocated: i.allocated ?? 0,
    minStock: i.minStock ?? 0,
    leadTimeDays: typeof i.leadTimeDays === "number" ? i.leadTimeDays : null,
    unitPrice: i.unitPrice ?? 0,
    value: round2((i.available ?? 0) * (i.unitPrice ?? 0)),
    status: getStockStatus(i.available ?? 0, i.minStock ?? 0),
    lastPurchaseDate: i.purchaseDate ? toDateInput(i.purchaseDate) : null,
  }));
}

export type Coverage = {
  /** Days the available stock lasts at the current rate; null without a rate. */
  daysOfCover: number | null;
  /** The day stock runs out at that rate. */
  stockoutDate: string | null;
  /** The last day to order so it arrives before the stockout (stockout − lead time). */
  orderBy: string | null;
};

/** How long `available` lasts at `perDay`, and when to order given a lead time. */
export function coverage(available: number, perDay: number | null, leadTimeDays: number | null, asOf: Date = new Date()): Coverage {
  if (!perDay || perDay <= 0) return { daysOfCover: null, stockoutDate: null, orderBy: null };
  const days = Math.max(0, available) / perDay;
  const stockout = addDays(startOfDayIST(asOf), Math.floor(days));
  return {
    daysOfCover: Math.round(days * 10) / 10,
    stockoutDate: toDateInput(stockout),
    orderBy: toDateInput(addDays(stockout, -(leadTimeDays ?? 0))),
  };
}

export type StockAlert = ItemPosition &
  ItemUsage &
  Coverage & {
    /** Why it is flagged, in plain words. */
    reasons: string[];
    /** below_min: at or under the minimum; runs_out: runs out within lead time + a week; out: nothing available. */
    level: "out" | "below_min" | "runs_out";
    /** Units to order to cover lead time + a week of use, plus the minimum level. */
    suggestedQty: number | null;
  };

/**
 * Items to act on: out of stock, at or below their minimum level, or running out (at the recorded
 * rate of use) within their lead time plus a week, so an order placed now arrives in time.
 */
export async function lookAheadAlerts(asOf: Date = new Date(), days = DEFAULT_WINDOW_DAYS): Promise<StockAlert[]> {
  const [items, usage] = await Promise.all([itemPositions(), usageByItem(days, asOf)]);
  const out: StockAlert[] = [];
  for (const i of items) {
    const u = usage.get(i.id) ?? { itemId: i.id, issued: 0, returned: 0, consumed: 0, wasted: 0, perDay: null, firstUse: null, lastUse: null, movements: 0 };
    const c = coverage(i.available, u.perDay, i.leadTimeDays, asOf);
    const reasons: string[] = [];
    let level: StockAlert["level"] | null = null;
    // Every item with nothing available is "out", minimum or not, on the same 3-decimal quantity
    // as getStockStatus in inventorySnapshot, so the reorder list, the banner and the stock cards agree.
    const avail = roundQty(i.available);
    if (avail <= 0) {
      level = "out";
      reasons.push("Nothing available");
    } else if (i.minStock > 0 && avail <= i.minStock) {
      level = "below_min";
      reasons.push(`At or below the minimum of ${i.minStock}`);
    }
    const horizon = (i.leadTimeDays ?? 0) + ALERT_BUFFER_DAYS;
    if (c.daysOfCover !== null && c.daysOfCover <= horizon && avail > 0) {
      level = level ?? "runs_out";
      reasons.push(
        i.leadTimeDays
          ? `Runs out in about ${Math.floor(c.daysOfCover)} days; ordering takes ${i.leadTimeDays} days`
          : `Runs out in about ${Math.floor(c.daysOfCover)} days at the recent rate of use`,
      );
    }
    if (!level) continue;
    const cover = u.perDay ? u.perDay * horizon : 0;
    const suggested = Math.max(0, Math.ceil(cover + i.minStock - i.available));
    out.push({ ...i, ...u, ...c, reasons, level, suggestedQty: suggested > 0 ? suggested : null });
  }
  const rank = { out: 0, below_min: 1, runs_out: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
}
