import "server-only";

import { Types } from "mongoose";
import { monthKeyIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { formatNumber, round2 } from "@/lib/format";
import { periodMatch, resolvePeriod, type InsightPeriod } from "./period";
import { itemInfo, loadBills, loadPurchaseEntries, materialRows, purchaseBillFilter, vendorRows, type PurchaseEntry } from "./purchases";
import { NO_VENDOR } from "../dashboard/rules";
import type { PriceChange, ProcurementInsights, PurchaseMonth } from "./types";

const TABLE_ROWS = 25;

/** Months in the trend chart: the period's months (the last 12 for all time), at most 24. */
function trendMonths(from: Date | null, now: Date): string[] {
  const start = from ?? startOfMonthIST(now, -11);
  const keys: string[] = [];
  for (let i = 0; i < 24; i++) {
    const m = startOfMonthIST(start, i);
    if (m.getTime() > now.getTime()) break;
    keys.push(monthKeyIST(m));
  }
  return keys.slice(-24);
}

/** First and latest recorded price per item, over every purchase entry with a price. */
function priceChanges(entries: PurchaseEntry[], info: Map<string, { name: string; unit: string }>): PriceChange[] {
  const by = new Map<string, PurchaseEntry[]>();
  for (const e of entries) {
    if (!(e.unitCost > 0)) continue;
    const id = String(e.item);
    by.set(id, [...(by.get(id) ?? []), e]);
  }
  const out: PriceChange[] = [];
  for (const [id, list] of by) {
    const i = info.get(id);
    if (!i || list.length < 2) continue;
    const first = list[0];
    const last = list[list.length - 1];
    out.push({
      id,
      name: i.name,
      unit: i.unit,
      purchases: list.length,
      firstDate: toDateInput(first.date),
      firstPrice: first.unitCost,
      lastDate: toDateInput(last.date),
      lastPrice: last.unitCost,
      change: first.unitCost > 0 ? (last.unitCost - first.unitCost) / first.unitCost : null,
      lastVendor: last.vendor?.trim().replace(/\s+/g, " ") || NO_VENDOR,
    });
  }
  return out.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || a.name.localeCompare(b.name));
}

/** 6.3 Procurement: purchase value by month, vendor and material, and price trends per item. */
export async function getProcurementInsights(periodValue: InsightPeriod, itemParam: string | null, now: Date = new Date()): Promise<ProcurementInsights> {
  const period = resolvePeriod(periodValue, now);
  const [bills, bought, allPriced, opening] = await Promise.all([
    loadBills(purchaseBillFilter(period)),
    loadPurchaseEntries({ date: periodMatch(period) }, true),
    loadPurchaseEntries({ unitCost: { $gt: 0 } }, false),
    loadPurchaseEntries({ date: periodMatch(period), expense: null }, false),
  ]);
  const info = await itemInfo([...new Set([...bought, ...allPriced].map((e) => String(e.item)))]);

  // Totals and the monthly trend come from the bills (what was paid, GST included).
  const keys = trendMonths(period.from, now);
  const months = new Map<string, PurchaseMonth>(keys.map((m) => [m, { month: m, stock: 0, materials: 0, equipment: 0 }]));
  const totals = { value: 0, stock: 0, materials: 0, equipment: 0, bills: bills.length, opening: 0, openingEntries: opening.length };
  for (const b of bills) {
    const kind = b.source === "inventory_purchase" ? "stock" : b.category === "equipment" ? "equipment" : "materials";
    totals[kind] = round2(totals[kind] + b.amount);
    totals.value = round2(totals.value + b.amount);
    const m = months.get(monthKeyIST(b.date));
    if (m) m[kind] = round2(m[kind] + b.amount);
  }
  totals.opening = round2(opening.reduce((s, e) => s + e.totalCost, 0));

  // Price trend: the asked item, else the item with the most priced purchases.
  const counts = new Map<string, number>();
  for (const e of allPriced) counts.set(String(e.item), (counts.get(String(e.item)) ?? 0) + 1);
  const priceItems = [...counts.entries()]
    .filter(([id]) => info.has(id))
    .map(([id, n]) => ({ value: id, label: info.get(id)!.name, description: `${info.get(id)!.sku}, ${formatNumber(n)} ${n === 1 ? "purchase" : "purchases"}`, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const pick = itemParam && Types.ObjectId.isValid(itemParam) && counts.has(itemParam) && info.has(itemParam) ? itemParam : (priceItems[0]?.value ?? null);
  const priceItem = pick
    ? {
        id: pick,
        name: info.get(pick)!.name,
        unit: info.get(pick)!.unit,
        points: allPriced
          .filter((e) => String(e.item) === pick)
          .map((e) => ({ date: toDateInput(e.date), price: e.unitCost, qty: e.quantity, vendor: e.vendor?.trim().replace(/\s+/g, " ") || NO_VENDOR, bought: Boolean(e.expense) })),
      }
    : null;

  return {
    period: period.period,
    phrase: period.phrase,
    totals,
    months: [...months.values()],
    vendors: vendorRows(bills, new Map(), new Map()).slice(0, TABLE_ROWS),
    materials: materialRows(bought, info).slice(0, TABLE_ROWS),
    priceItems: priceItems.map(({ value, label, description }) => ({ value, label, description })),
    priceItem,
    priceChanges: priceChanges(allPriced, info).slice(0, TABLE_ROWS),
  };
}
