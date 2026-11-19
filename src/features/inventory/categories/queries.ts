import "server-only";

import { connectDB } from "@/server/db";
import { InventoryCategory, InventoryItem } from "@/server/models";
import { round2 } from "@/lib/format";
import type { CategoryRow } from "./types";

type Totals = { _id: unknown; items: number; value: number; low: number; out: number };

/** Every category with its active item count, stock value and low / out counts. */
export async function listCategories(): Promise<{ rows: CategoryRow[]; uncategorized: number }> {
  await connectDB();
  const [categories, totals] = await Promise.all([
    InventoryCategory.find().sort({ name: 1 }).collation({ locale: "en", strength: 2 }).lean(),
    InventoryItem.aggregate<Totals>([
      { $match: { archivedAt: null } },
      {
        $group: {
          _id: "$category",
          items: { $sum: 1 },
          value: { $sum: { $multiply: ["$available", "$unitPrice"] } },
          out: { $sum: { $cond: [{ $lte: ["$available", 0] }, 1, 0] } },
          low: { $sum: { $cond: [{ $and: [{ $gt: ["$available", 0] }, { $lte: ["$available", "$minStock"] }] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const byId = new Map(totals.map((t) => [t._id ? String(t._id) : "none", t]));
  return {
    rows: categories.map((c) => {
      const t = byId.get(String(c._id));
      return {
        id: String(c._id),
        name: c.name,
        description: c.description ?? null,
        color: c.color ?? "#4a82cc",
        itemCount: t?.items ?? 0,
        totalValue: round2(t?.value ?? 0),
        lowCount: t?.low ?? 0,
        outCount: t?.out ?? 0,
      };
    }),
    uncategorized: byId.get("none")?.items ?? 0,
  };
}
