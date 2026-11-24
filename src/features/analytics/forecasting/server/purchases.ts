import "server-only";

import { addDays, fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { ForecastFilters, HistoryWindow } from "../params";
import type { DemandRow, PurchaseRow } from "../types";
import { demandForecast, lastPurchasePrices } from "./demand";

/**
 * Purchase requirements: recommendations only. Nothing here creates a purchase, an order or stock.
 *
 *  - requirement = daily rate × (horizon + lead time): what will be used before a new order could
 *    arrive and then last the horizon
 *  - suggested quantity = requirement + minimum level − available, never negative
 *  - reorder date = stockout − lead time; today when that day has passed
 *  - price = the last purchase price, else the average cost of stock on hand
 * Purchase orders and expected deliveries are not recorded, so nothing is assumed on order.
 */

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toPurchaseRow(row: DemandRow, horizon: number, prices: Map<string, number>, today: string): PurchaseRow {
  const lead = row.leadTimeDays ?? 0;
  const requirement = row.perDay ? round3(row.perDay * (horizon + lead)) : null;
  let suggestedQty = 0;
  let basis: PurchaseRow["basis"] = "none";
  if (requirement !== null) {
    suggestedQty = Math.max(0, Math.ceil(round3(requirement + row.minStock - row.available)));
    basis = "forecast";
  } else if (row.minStock > 0 && row.available < row.minStock) {
    // No rate to forecast with: bring the item back to its minimum level, nothing more.
    suggestedQty = Math.ceil(round3(row.minStock - row.available));
    basis = "minimum";
  }

  let reorderDate: string | null = null;
  let lateBy = 0;
  if (suggestedQty > 0) {
    if (basis === "forecast" && row.orderBy) {
      reorderDate = row.orderBy < today ? today : row.orderBy;
      lateBy = row.orderBy < today ? Math.round((fromDateInput(today).getTime() - fromDateInput(row.orderBy).getTime()) / DAY_MS) : 0;
    } else reorderDate = today;
  }

  const last = prices.get(row.id);
  const price = last && last > 0 ? last : row.unitPrice > 0 ? row.unitPrice : null;
  const priceBasis: PurchaseRow["priceBasis"] = last && last > 0 ? "last_purchase" : row.unitPrice > 0 ? "average" : null;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    categoryName: row.categoryName,
    available: row.available,
    allocated: row.allocated,
    minStock: row.minStock,
    perDay: row.perDay,
    status: row.status,
    reason: row.reason,
    leadTimeDays: row.leadTimeDays,
    requirement,
    suggestedQty,
    basis,
    reorderDate,
    lateBy,
    stockoutDate: row.stockoutDate,
    price,
    priceBasis,
    estimatedCost: price !== null && suggestedQty > 0 ? round2(price * suggestedQty) : null,
  };
}

export type PurchasePlan = {
  rows: PurchaseRow[];
  /** Active items before the filters. */
  totalItems: number;
  toBuy: number;
  estimatedCost: number;
  /** Items to buy with no price recorded (left out of the cost). */
  unpriced: number;
  /** To order today: the order-by date has come or passed. */
  orderNow: number;
  /** To order within the next 7 days. */
  orderThisWeek: number;
  noLeadTime: number;
};

export async function purchasePlan(window: HistoryWindow, filters: ForecastFilters, horizon: number, now: Date = new Date()): Promise<PurchasePlan> {
  const [{ rows, totalItems }, prices] = await Promise.all([demandForecast(window, filters, now), lastPurchasePrices()]);
  const today = toDateInput(now);
  const weekEnd = toDateInput(addDays(startOfDayIST(now), 7));
  const out = rows
    .map((r) => toPurchaseRow(r, horizon, prices, today))
    .sort((a, b) => (b.suggestedQty > 0 ? 1 : 0) - (a.suggestedQty > 0 ? 1 : 0) || (a.reorderDate ?? "9999").localeCompare(b.reorderDate ?? "9999") || a.name.localeCompare(b.name));
  const buying = out.filter((r) => r.suggestedQty > 0);
  return {
    rows: out,
    totalItems,
    toBuy: buying.length,
    estimatedCost: round2(buying.reduce((s, r) => s + (r.estimatedCost ?? 0), 0)),
    unpriced: buying.filter((r) => r.estimatedCost === null).length,
    orderNow: buying.filter((r) => r.reorderDate === today).length,
    orderThisWeek: buying.filter((r) => r.reorderDate !== null && r.reorderDate > today && r.reorderDate <= weekEnd).length,
    noLeadTime: buying.filter((r) => r.leadTimeDays === null).length,
  };
}
