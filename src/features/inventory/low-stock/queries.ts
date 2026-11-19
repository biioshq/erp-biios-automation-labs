import "server-only";

import type { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem } from "@/server/models";
import { getStockStatus, stockStatusFilter } from "@/lib/stock-status";
import { round2 } from "@/lib/format";
import type { LowStockItem, LowStockSummary } from "./types";

type PopulatedCategory = { _id: Types.ObjectId; name: string; color?: string } | null;

/** Units worth ordering: back up to twice the minimum, and never less than the minimum itself. */
export function suggestedReorder(available: number, minStock: number) {
  return Math.max(Math.ceil(minStock * 2 - available), minStock, 1);
}

/** Every item that is low or out of stock: out of stock first, then the emptiest relative to its minimum. */
export async function getLowStockItems(): Promise<{ items: LowStockItem[]; summary: LowStockSummary }> {
  await connectDB();
  const docs = await InventoryItem.find({
    archivedAt: null,
    $or: [stockStatusFilter("out_of_stock"), stockStatusFilter("low_stock")],
  } as Record<string, unknown>)
    .populate("category", "name color")
    .lean();

  const items: LowStockItem[] = docs.map((i) => {
    const category = i.category as unknown as PopulatedCategory;
    const unitPrice = i.lastPurchasePrice ?? i.unitPrice;
    const suggestedQuantity = suggestedReorder(i.available, i.minStock);
    return {
      id: String(i._id),
      name: i.name,
      sku: i.sku,
      unit: i.unit ?? "pcs",
      status: getStockStatus(i.available, i.minStock) as LowStockItem["status"],
      available: i.available,
      allocated: i.allocated,
      quantity: i.quantity,
      minStock: i.minStock,
      suggestedQuantity,
      unitPrice,
      estimatedCost: round2(suggestedQuantity * unitPrice),
      vendor: i.vendor ?? null,
      category: category?._id ? { name: category.name, color: category.color ?? "#4a82cc" } : null,
    };
  });

  const ratio = (i: LowStockItem) => (i.minStock > 0 ? i.available / i.minStock : 0);
  items.sort((a, b) => Number(b.status === "out_of_stock") - Number(a.status === "out_of_stock") || ratio(a) - ratio(b) || a.name.localeCompare(b.name));

  return {
    items,
    summary: {
      low: items.filter((i) => i.status === "low_stock").length,
      out: items.filter((i) => i.status === "out_of_stock").length,
      estimatedCost: round2(items.reduce((sum, i) => sum + i.estimatedCost, 0)),
    },
  };
}
