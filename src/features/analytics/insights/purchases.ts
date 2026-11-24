import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, InventoryItem, InventoryMovement } from "@/server/models";
import { toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { periodMatch, type ResolvedPeriod } from "./period";
import { vendorName } from "./shared";
import type { MaterialRow, VendorRow } from "./types";

/**
 * Purchase records read by the procurement and vendor pages.
 *
 *  - A purchase bill is an expense: stock bought (source "inventory_purchase", one per stock
 *    purchase) and material or equipment bills entered by hand or by a recurring schedule. Stock
 *    issued to projects and wastage are generated from stock already bought, so they are left out.
 *  - Vendor bills are every bill from a supplier: the same sources, any category except salaries.
 *  - Item quantities and prices come from purchase entries in the stock ledger (before GST). An
 *    entry without an expense is opening or imported stock, not a purchase, as in the accounts.
 */

export const PURCHASE_CATEGORIES = ["materials", "equipment", "inventory"];
const BILL_SOURCES = ["manual", "recurring"];

/** Expenses that are purchases of stock, materials or equipment. */
export function purchaseBillFilter(p: ResolvedPeriod): Record<string, unknown> {
  return {
    date: periodMatch(p),
    countedAtPurchase: { $ne: true },
    $or: [{ source: "inventory_purchase" }, { source: { $in: BILL_SOURCES }, category: { $in: PURCHASE_CATEGORIES } }],
  };
}

/** Every supplier bill (salaries are pay, not purchases). */
export function vendorBillFilter(p: ResolvedPeriod | null): Record<string, unknown> {
  return {
    ...(p ? { date: periodMatch(p) } : {}),
    countedAtPurchase: { $ne: true },
    category: { $ne: "salaries" },
    source: { $in: ["inventory_purchase", ...BILL_SOURCES] },
  };
}

export type BillLite = { _id: Types.ObjectId; vendor: string; amount: number; date: Date; source: string; category: string; item?: Types.ObjectId | null };

export async function loadBills(filter: Record<string, unknown>): Promise<BillLite[]> {
  await connectDB();
  return Expense.find(filter, { vendor: 1, amount: 1, date: 1, source: 1, category: 1, item: 1 }).sort({ date: 1 }).lean<BillLite[]>();
}

/** Bills grouped by vendor (names matched without case), biggest value first. */
export function vendorRows(bills: BillLite[], outstandingBy: Map<string, number>, names: Map<string, string>): VendorRow[] {
  const out = new Map<string, VendorRow & { itemSet: Set<string> }>();
  for (const b of bills) {
    const { key, name } = vendorName(names, b.vendor);
    const day = toDateInput(b.date);
    const v = out.get(key) ?? { key, name, bills: 0, value: 0, stock: 0, first: day, last: day, outstanding: outstandingBy.get(key) ?? 0, items: 0, itemSet: new Set<string>() };
    v.name = name;
    v.bills += 1;
    v.value = round2(v.value + b.amount);
    if (b.source === "inventory_purchase") v.stock += 1;
    if (b.item) v.itemSet.add(String(b.item));
    if (day < v.first) v.first = day;
    if (day > v.last) v.last = day;
    out.set(key, v);
  }
  return [...out.values()]
    .map(({ itemSet, ...v }) => ({ ...v, items: itemSet.size }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export type PurchaseEntry = {
  _id: Types.ObjectId;
  item: Types.ObjectId;
  quantity: number;
  unitCost: number;
  totalCost: number;
  vendor?: string | null;
  date: Date;
  expense?: Types.ObjectId | null;
};

/** Purchase entries in the stock ledger. `boughtOnly` leaves out opening and imported stock. */
export async function loadPurchaseEntries(filter: Record<string, unknown>, boughtOnly: boolean): Promise<PurchaseEntry[]> {
  await connectDB();
  return InventoryMovement.find(
    { type: "purchase", ...filter, ...(boughtOnly ? { expense: { $ne: null } } : {}) },
    { item: 1, quantity: 1, unitCost: 1, totalCost: 1, vendor: 1, date: 1, expense: 1 },
  )
    .sort({ date: 1, _id: 1 })
    .lean<PurchaseEntry[]>();
}

export type ItemInfo = { name: string; sku: string; unit: string; archived: boolean };

export async function itemInfo(ids: string[]): Promise<Map<string, ItemInfo>> {
  if (!ids.length) return new Map();
  await connectDB();
  const items = await InventoryItem.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, { name: 1, sku: 1, unit: 1, archivedAt: 1 }).lean();
  return new Map(items.map((i) => [String(i._id), { name: i.name, sku: i.sku, unit: i.unit ?? "pcs", archived: Boolean(i.archivedAt) }]));
}

/** Quantity, value and prices per item over the given entries, biggest value first. */
export function materialRows(entries: PurchaseEntry[], info: Map<string, ItemInfo>): MaterialRow[] {
  const out = new Map<string, MaterialRow & { vendorSet: Set<string> }>();
  for (const e of entries) {
    const id = String(e.item);
    const i = info.get(id);
    if (!i) continue;
    const r = out.get(id) ?? {
      id,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      purchases: 0,
      qty: 0,
      value: 0,
      avgPrice: null,
      minPrice: e.unitCost,
      maxPrice: e.unitCost,
      lastPrice: e.unitCost,
      vendors: 0,
      vendorSet: new Set<string>(),
    };
    r.purchases += 1;
    r.qty = Math.round((r.qty + e.quantity) * 1000) / 1000;
    r.value = round2(r.value + e.totalCost);
    r.minPrice = Math.min(r.minPrice, e.unitCost);
    r.maxPrice = Math.max(r.maxPrice, e.unitCost);
    r.lastPrice = e.unitCost;
    if (e.vendor?.trim()) r.vendorSet.add(e.vendor.trim().toLowerCase());
    out.set(id, r);
  }
  return [...out.values()]
    .map(({ vendorSet, ...r }) => ({ ...r, vendors: vendorSet.size, avgPrice: r.qty > 0 ? round2(r.value / r.qty) : null }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
