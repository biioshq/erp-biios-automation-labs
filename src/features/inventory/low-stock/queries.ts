import "server-only";

import type { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem } from "@/server/models";
import { ALERT_BUFFER_DAYS, DEFAULT_WINDOW_DAYS, lookAheadAlerts } from "@/server/analytics/core";
import { roundQty } from "@/server/services/inventory-ledger";
import { getStockStatus } from "@/lib/stock-status";
import { toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { LowStockItem, LowStockSummary } from "./types";

type PopulatedCategory = { _id: Types.ObjectId; name: string; color?: string } | null;

/**
 * The reorder list: items out of stock, at or below their minimum, or running out within their
 * lead time plus a week at the recent rate of use (the shared rule in src/server/analytics/core.ts,
 * the same one the daily alerts use). Out of stock first, then the soonest to run out.
 */
export async function getLowStockItems(asOf: Date = new Date()): Promise<{ items: LowStockItem[]; summary: LowStockSummary }> {
  await connectDB();
  const alerts = await lookAheadAlerts(asOf);
  const extra = alerts.length
    ? await InventoryItem.find({ _id: { $in: alerts.map((a) => a.id) } }, { lastPurchasePrice: 1, category: 1 })
        .populate("category", "name color")
        .lean()
    : [];
  const byId = new Map(extra.map((i) => [String(i._id), i]));

  const items: LowStockItem[] = alerts.map((a) => {
    const more = byId.get(a.id);
    const category = more?.category as unknown as PopulatedCategory;
    const unitPrice = more?.lastPurchasePrice ?? a.unitPrice;
    // Rounded to the ledger's 3 decimals so drift older writes stored (5.55e-17) shows as 0.
    const available = roundQty(a.available);
    return {
      id: a.id,
      name: a.name,
      sku: a.sku,
      unit: a.unit,
      status: getStockStatus(available, a.minStock),
      level: a.level,
      reasons: a.reasons,
      available,
      allocated: roundQty(a.allocated),
      quantity: roundQty(a.available + a.allocated),
      minStock: a.minStock,
      perDay: a.perDay,
      daysOfCover: a.daysOfCover,
      stockoutDate: a.stockoutDate,
      orderBy: a.orderBy,
      leadTimeDays: a.leadTimeDays,
      suggestedQty: a.suggestedQty,
      unitPrice,
      estimatedCost: a.suggestedQty ? round2(a.suggestedQty * unitPrice) : null,
      vendor: a.vendor,
      category: category?._id ? { name: category.name, color: category.color ?? "#4a82cc" } : null,
    };
  });

  const today = toDateInput(asOf);
  return {
    items,
    summary: {
      out: items.filter((i) => i.level === "out").length,
      belowMin: items.filter((i) => i.level === "below_min").length,
      runsOut: items.filter((i) => i.level === "runs_out").length,
      orderNow: items.filter((i) => i.orderBy !== null && i.orderBy <= today).length,
      estimatedCost: round2(items.reduce((sum, i) => sum + (i.estimatedCost ?? 0), 0)),
      windowDays: DEFAULT_WINDOW_DAYS,
      bufferDays: ALERT_BUFFER_DAYS,
    },
  };
}
