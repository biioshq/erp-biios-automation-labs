import "server-only";

import { connectDB } from "@/server/db";
import { InventoryCategory, InventoryItem } from "@/server/models";
import { roundQty } from "@/server/services/inventory-ledger";
import { round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import type { CategoryRow } from "./types";

type Totals = { items: number; value: number; low: number; out: number };

/** Every category with its active item count, stock value and low / out counts. */
export async function listCategories(): Promise<{ rows: CategoryRow[]; uncategorized: number }> {
  await connectDB();
  const [categories, items] = await Promise.all([
    InventoryCategory.find().sort({ name: 1 }).collation({ locale: "en", strength: 2 }).lean(),
    InventoryItem.find({ archivedAt: null }, { category: 1, available: 1, unitPrice: 1, minStock: 1 }).lean(),
  ]);
  // Added up per item, each value rounded to paise first, as inventorySnapshot and the reports do,
  // so a category's value matches the dashboard and the valuation report to the paisa. The status
  // counts use the same rule as the badges (getStockStatus on the 3-decimal quantity).
  const byId = new Map<string, Totals>();
  for (const i of items) {
    const key = i.category ? String(i.category) : "none";
    const t = byId.get(key) ?? { items: 0, value: 0, low: 0, out: 0 };
    t.items += 1;
    t.value = round2(t.value + round2(i.available * i.unitPrice));
    const status = getStockStatus(roundQty(i.available), i.minStock ?? 0);
    if (status === "out_of_stock") t.out += 1;
    else if (status === "low_stock") t.low += 1;
    byId.set(key, t);
  }
  return {
    rows: categories.map((c) => {
      const t = byId.get(String(c._id));
      return {
        id: String(c._id),
        name: c.name,
        description: c.description ?? null,
        color: c.color ?? "#4a82cc",
        itemCount: t?.items ?? 0,
        totalValue: t?.value ?? 0,
        lowCount: t?.low ?? 0,
        outCount: t?.out ?? 0,
      };
    }),
    uncategorized: byId.get("none")?.items ?? 0,
  };
}
