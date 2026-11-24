import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryMovement } from "@/server/models";
import { itemPositions } from "@/server/analytics/core";
import { fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { NOT_OPENING_ON_HAND } from "@/lib/inventory-opening";
import { round3 } from "./data";

/**
 * Inventory ageing (4.3): how long the stock in storage has been held.
 *
 * The ledger keeps no lot numbers, so ages follow FIFO: the units in storage now are taken to be
 * the most recent purchases, older purchases having been used first. Each item's available
 * quantity is matched against its purchase movements, newest first; a unit's age is the days
 * since that purchase. Units that no recorded purchase covers (stock added by an adjustment, opening
 * stock entered as already on hand, or stock entered before purchases were recorded) have no known
 * date and show as "age not recorded".
 * Stock in use on projects is not aged here: it has left the store. Units are valued at the
 * item's average cost, as the inventory value everywhere else is, so the buckets add up to it.
 */

export type AgeBucket = { key: string; label: string; min: number; max: number | null };

/** Buckets from rising edges: [30, 60, 90] gives 0-30, 31-60, 61-90 and more than 90 days. */
export function bucketsOf(edges: number[]): AgeBucket[] {
  const out: AgeBucket[] = [];
  let min = 0;
  for (const e of edges) {
    out.push({ key: `${min}-${e}`, label: `${min}-${e} days`, min, max: e });
    min = e + 1;
  }
  out.push({ key: `${min}+`, label: `More than ${edges[edges.length - 1]} days`, min, max: null });
  return out;
}

export const UNDATED = "undated";

export type Lot = { day: string; quantity: number; age: number };

export type AgeingRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  categoryName: string | null;
  available: number;
  unitPrice: number;
  value: number;
  lots: Lot[];
  /** Units per bucket key (and UNDATED). */
  qtyByBucket: Record<string, number>;
  valueByBucket: Record<string, number>;
  oldestDay: string | null;
  newestDay: string | null;
  /** Average age of the dated units, weighted by quantity. */
  averageAge: number | null;
  undatedQty: number;
};

export type BucketTotal = AgeBucket & { value: number; items: number };

export type AgeingData = {
  buckets: AgeBucket[];
  rows: AgeingRow[];
  totals: BucketTotal[];
  undated: { value: number; items: number };
  totalValue: number;
  longPending: AgeingRow[];
  oldestBucketKey: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The FIFO split of `available` over purchases (newest first). Exported for tests. */
export function fifoLots(available: number, purchases: { day: string; quantity: number }[], today: string): { lots: Lot[]; undated: number } {
  let left = round3(Math.max(0, available));
  const lots: Lot[] = [];
  for (const p of purchases) {
    if (left <= 0) break;
    const take = round3(Math.min(left, p.quantity));
    if (take <= 0) continue;
    lots.push({ day: p.day, quantity: take, age: Math.round((fromDateInput(today).getTime() - fromDateInput(p.day).getTime()) / DAY_MS) });
    left = round3(left - take);
  }
  return { lots, undated: left };
}

export const bucketFor = (buckets: AgeBucket[], age: number) => buckets.find((b) => age >= b.min && (b.max === null || age <= b.max)) ?? buckets[buckets.length - 1];

export async function getAgeing(edges: number[], now: Date = new Date()): Promise<AgeingData> {
  await connectDB();
  const buckets = bucketsOf(edges);
  const today = toDateInput(startOfDayIST(now));
  const items = (await itemPositions()).filter((i) => i.available > 0);
  const purchases = items.length
    ? await InventoryMovement.find(
        {
          type: "purchase",
          item: { $in: items.map((i) => new Types.ObjectId(i.id)) },
          date: { $lte: now },
          // Opening stock entered as already on hand carries the day it was entered, not bought.
          ...NOT_OPENING_ON_HAND,
        },
        { item: 1, quantity: 1, date: 1 },
      )
        .sort({ date: -1, _id: -1 })
        .lean()
    : [];
  const byItem = new Map<string, { day: string; quantity: number }[]>();
  for (const p of purchases) {
    const list = byItem.get(String(p.item)) ?? [];
    list.push({ day: toDateInput(p.date), quantity: p.quantity });
    byItem.set(String(p.item), list);
  }

  const rows: AgeingRow[] = items.map((i) => {
    const { lots, undated } = fifoLots(i.available, byItem.get(i.id) ?? [], today);
    const qtyByBucket: Record<string, number> = {};
    const valueByBucket: Record<string, number> = {};
    for (const l of lots) {
      const b = bucketFor(buckets, l.age);
      qtyByBucket[b.key] = round3((qtyByBucket[b.key] ?? 0) + l.quantity);
    }
    if (undated > 0) qtyByBucket[UNDATED] = undated;
    for (const [k, q] of Object.entries(qtyByBucket)) valueByBucket[k] = round2(q * i.unitPrice);
    // Rounding each part can leave a paisa over or short; the largest part takes it, so an
    // item's buckets always add up to its stock value.
    const keys = Object.keys(valueByBucket);
    if (keys.length) {
      const drift = round2(i.value - keys.reduce((s, k) => s + valueByBucket[k], 0));
      const largest = keys.reduce((a, b) => (valueByBucket[b] > valueByBucket[a] ? b : a));
      valueByBucket[largest] = round2(valueByBucket[largest] + drift);
    }
    const dated = lots.reduce((s, l) => s + l.quantity, 0);
    return {
      id: i.id,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      categoryName: i.categoryName,
      available: i.available,
      unitPrice: i.unitPrice,
      value: i.value,
      lots,
      qtyByBucket,
      valueByBucket,
      oldestDay: lots.length ? lots[lots.length - 1].day : null,
      newestDay: lots.length ? lots[0].day : null,
      averageAge: dated > 0 ? Math.round(lots.reduce((s, l) => s + l.age * l.quantity, 0) / dated) : null,
      undatedQty: undated,
    };
  });

  const totals: BucketTotal[] = buckets.map((b) => {
    const holding = rows.filter((r) => (r.qtyByBucket[b.key] ?? 0) > 0);
    return { ...b, value: round2(holding.reduce((s, r) => s + (r.valueByBucket[b.key] ?? 0), 0)), items: holding.length };
  });
  const undatedRows = rows.filter((r) => r.undatedQty > 0);
  const oldest = buckets[buckets.length - 1];
  return {
    buckets,
    rows: rows.sort((a, b) => (b.averageAge ?? -1) - (a.averageAge ?? -1) || b.value - a.value),
    totals,
    undated: { value: round2(undatedRows.reduce((s, r) => s + (r.valueByBucket[UNDATED] ?? 0), 0)), items: undatedRows.length },
    totalValue: round2(rows.reduce((s, r) => s + r.value, 0)),
    longPending: rows
      .filter((r) => (r.qtyByBucket[oldest.key] ?? 0) > 0)
      .sort((a, b) => (b.valueByBucket[oldest.key] ?? 0) - (a.valueByBucket[oldest.key] ?? 0)),
    oldestBucketKey: oldest.key,
  };
}
