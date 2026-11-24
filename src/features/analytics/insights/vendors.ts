import "server-only";

import { connectDB } from "@/server/db";
import { Expense } from "@/server/models";
import { paymentState } from "@/lib/payments";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { NO_VENDOR, vendorKey } from "../dashboard/rules";
import { periodMatch, resolvePeriod, type InsightPeriod } from "./period";
import { itemInfo, loadBills, loadPurchaseEntries, vendorBillFilter, vendorRows, type PurchaseEntry } from "./purchases";
import { vendorName, viewerPayables } from "./shared";
import type { PriceComparison, VendorInsights, VendorPrice } from "./types";

const COMPARISONS = 25;
const HISTORY_ROWS = 100;
const MAX_VENDOR_PARAM = 200;

/** Items bought from two or more vendors: each vendor's average and latest price (before GST). */
function priceComparisons(entries: PurchaseEntry[], info: Map<string, { name: string; unit: string }>): PriceComparison[] {
  const names = new Map<string, string>();
  const byItem = new Map<string, Map<string, VendorPrice & { value: number }>>();
  for (const e of entries) {
    if (!(e.unitCost > 0) || !vendorKey(e.vendor)) continue;
    const id = String(e.item);
    const { key, name } = vendorName(names, e.vendor);
    const vendors = byItem.get(id) ?? new Map<string, VendorPrice & { value: number }>();
    const v = vendors.get(key) ?? { vendor: name, purchases: 0, qty: 0, value: 0, avgPrice: 0, lastPrice: e.unitCost, lastDate: toDateInput(e.date) };
    v.vendor = name;
    v.purchases += 1;
    v.qty += e.quantity;
    v.value += e.quantity * e.unitCost;
    v.lastPrice = e.unitCost;
    v.lastDate = toDateInput(e.date);
    vendors.set(key, v);
    byItem.set(id, vendors);
  }
  const out: PriceComparison[] = [];
  for (const [id, vendors] of byItem) {
    const i = info.get(id);
    if (!i || vendors.size < 2) continue;
    const list = [...vendors.values()]
      .map(({ value, ...v }) => ({ ...v, qty: Math.round(v.qty * 1000) / 1000, avgPrice: v.qty > 0 ? round2(value / v.qty) : v.lastPrice }))
      .sort((a, b) => a.avgPrice - b.avgPrice);
    const low = list[0].avgPrice;
    const high = list[list.length - 1].avgPrice;
    out.push({ id, name: i.name, unit: i.unit, vendors: list, spread: low > 0 ? (high - low) / low : null });
  }
  return out.sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0) || a.name.localeCompare(b.name));
}

/** Matches a stored vendor name to a vendorKey: same words, any case and spacing. Blank: no name. */
function vendorPattern(key: string): RegExp {
  if (!key) return /^\s*$/;
  const words = key.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${words.join("\\s+")}\\s*$`, "i");
}

/** One vendor's bills (newest first) and stock purchases, over all recorded time. */
async function vendorHistory(key: string, now: Date) {
  await connectDB();
  const pattern = vendorPattern(key);
  const [bills, entries, labelOf] = await Promise.all([
    Expense.find({ ...vendorBillFilter(null), vendor: pattern }, { number: 1, vendor: 1, date: 1, category: 1, description: 1, amount: 1, paymentMethod: 1, payments: 1, dueDate: 1, account: 1 })
      .sort({ date: -1 })
      .limit(HISTORY_ROWS)
      .lean(),
    loadPurchaseEntries(key ? { vendor: pattern } : { $or: [{ vendor: null }, { vendor: pattern }] }, true),
    getExpenseCategoryLabeler(),
  ]);
  const recent = entries.reverse().slice(0, HISTORY_ROWS);
  const info = await itemInfo([...new Set(recent.map((e) => String(e.item)))]);
  return {
    name: bills[0]?.vendor?.trim() || recent[0]?.vendor?.trim() || NO_VENDOR,
    bills: bills.map((b) => {
      const s = paymentState(b, now);
      return {
        id: String(b._id),
        number: b.number,
        date: toDateInput(b.date),
        category: labelOf(b.category),
        description: b.description ?? null,
        amount: b.amount,
        outstanding: s.outstanding,
        status: s.status,
      };
    }),
    purchases: recent.flatMap((e) => {
      const i = info.get(String(e.item));
      return i ? [{ id: String(e._id), item: i.name, itemId: String(e.item), date: toDateInput(e.date), qty: e.quantity, unit: i.unit, price: e.unitCost, value: e.totalCost }] : [];
    }),
  };
}

/** 6.4 Vendor performance: what is recorded per vendor (bills, value, prices) and what is not. */
export async function getVendorInsights(periodValue: InsightPeriod, vendorParam: string | null, viewer: { isAdmin: boolean }, now: Date = new Date()): Promise<VendorInsights> {
  const period = resolvePeriod(periodValue, now);
  const [bills, entries, payables] = await Promise.all([
    loadBills(vendorBillFilter(period)),
    loadPurchaseEntries({ date: periodMatch(period), unitCost: { $gt: 0 } }, false),
    viewerPayables(viewer.isAdmin, now),
  ]);
  // Outstanding today on supplier bills (salary bills are never vendor bills here).
  const supplierRows = payables.rows.filter((r) => r.category !== "salaries");
  const outstandingBy = new Map<string, number>();
  for (const r of supplierRows) outstandingBy.set(vendorKey(r.vendor), round2((outstandingBy.get(vendorKey(r.vendor)) ?? 0) + r.outstanding));
  const names = new Map<string, string>();
  const vendors = vendorRows(bills, outstandingBy, names);
  const info = await itemInfo([...new Set(entries.map((e) => String(e.item)))]);

  let selected: VendorInsights["selected"] = null;
  if (vendorParam !== null) {
    // Vendor names are at most a few dozen characters; a longer value cannot match one.
    const key = vendorKey(vendorParam.slice(0, MAX_VENDOR_PARAM));
    const history = await vendorHistory(key, now);
    if (history.bills.length || history.purchases.length) {
      const row = vendors.find((v) => v.key === key) ?? null;
      // The spelling the vendor table shows, so the heading and the row agree.
      const name = key ? (row?.name ?? history.name.replace(/\s+/g, " ")) : NO_VENDOR;
      selected = { key, name, row, bills: history.bills, purchases: history.purchases };
    }
  }

  return {
    period: period.period,
    phrase: period.phrase,
    totals: {
      bills: bills.length,
      value: round2(bills.reduce((s, b) => s + b.amount, 0)),
      vendors: vendors.length,
      stockPurchases: bills.filter((b) => b.source === "inventory_purchase").length,
      outstanding: round2(supplierRows.reduce((s, r) => s + r.outstanding, 0)),
    },
    vendors,
    comparisons: priceComparisons(entries, info).slice(0, COMPARISONS),
    selected,
  };
}
