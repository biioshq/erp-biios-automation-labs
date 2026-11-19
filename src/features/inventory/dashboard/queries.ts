import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryCategory, InventoryItem, InventoryMovement } from "@/server/models";
import { inventorySnapshot } from "@/server/services/metrics";
import { iso } from "@/server/serialize";
import { addDays, startOfDayIST } from "@/lib/dates";
import { formatDateShort, round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import type { InventoryUnit, MovementType } from "@/lib/constants";
import type { AttentionItem, CategoryValue, InventoryDashboardData, RecentMovement, WeeklyMovement } from "./types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const DEFAULT_COLOR = "#4a82cc";

async function valueByCategory(): Promise<CategoryValue[]> {
  const [groups, categories] = await Promise.all([
    InventoryItem.aggregate<{ _id: Types.ObjectId | null; value: number; items: number }>([
      { $match: { archivedAt: null } },
      { $group: { _id: "$category", value: { $sum: { $multiply: ["$available", "$unitPrice"] } }, items: { $sum: 1 } } },
    ]),
    InventoryCategory.find().lean(),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  return groups
    .map((g) => {
      const category = g._id ? byId.get(String(g._id)) : null;
      return {
        name: category?.name ?? "Uncategorized",
        color: category?.color ?? DEFAULT_COLOR,
        value: round2(g.value),
        items: g.items,
      };
    })
    .sort((a, b) => b.value - a.value);
}

/** Purchased, assigned and returned units per week over the last 30 days (IST days). */
async function weeklyMovement(): Promise<WeeklyMovement[]> {
  const start = addDays(startOfDayIST(), -(WINDOW_DAYS - 1));
  const rows = await InventoryMovement.aggregate<{ _id: { type: MovementType; week: number }; quantity: number }>([
    { $match: { date: { $gte: start }, type: { $in: ["purchase", "assign", "return"] } } },
    {
      $group: {
        _id: { type: "$type", week: { $floor: { $divide: [{ $subtract: ["$date", start] }, WEEK_MS] } } },
        quantity: { $sum: "$quantity" },
      },
    },
  ]);
  const weeks = Math.ceil(WINDOW_DAYS / 7);
  return Array.from({ length: weeks }, (_, w) => {
    const from = addDays(start, w * 7);
    const to = addDays(start, Math.min(w * 7 + 6, WINDOW_DAYS - 1));
    const qty = (type: MovementType) => rows.find((r) => r._id.type === type && r._id.week === w)?.quantity ?? 0;
    return {
      label: formatDateShort(from),
      range: `${formatDateShort(from)} to ${formatDateShort(to)}`,
      purchased: qty("purchase"),
      assigned: qty("assign"),
      returned: qty("return"),
    };
  });
}

async function needsAttention(): Promise<AttentionItem[]> {
  const items = await InventoryItem.find({ archivedAt: null, $expr: { $lte: ["$available", "$minStock"] } })
    .sort({ available: 1, name: 1 })
    .limit(8)
    .lean();
  return items.map((i) => ({
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    unit: (i.unit ?? "pcs") as InventoryUnit,
    available: i.available,
    minStock: i.minStock,
    status: getStockStatus(i.available, i.minStock),
    quantity: i.quantity,
  }));
}

async function recentMovements(): Promise<RecentMovement[]> {
  const docs = await InventoryMovement.find()
    .sort({ date: -1, _id: -1 })
    .limit(8)
    .populate("item", "name sku unit")
    .populate("project", "name color")
    .populate("createdBy", "name")
    .lean();
  return docs.map((m) => {
    const item = m.item as unknown as { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
    const project = m.project as unknown as { _id: Types.ObjectId; name: string; color?: string } | null;
    const user = m.createdBy as unknown as { name?: string } | null;
    return {
      id: String(m._id),
      type: m.type as MovementType,
      quantity: m.quantity,
      availableDelta: m.availableDelta,
      date: iso(m.date)!,
      item: item?._id ? { id: String(item._id), name: item.name, sku: item.sku, unit: (item.unit ?? "pcs") as InventoryUnit } : null,
      project: project?._id ? { id: String(project._id), name: project.name, color: project.color ?? DEFAULT_COLOR } : null,
      user: user?.name ?? null,
    };
  });
}

export async function getInventoryDashboard(): Promise<InventoryDashboardData> {
  await connectDB();
  const [snapshot, categories, weekly, attention, recent] = await Promise.all([
    inventorySnapshot(),
    valueByCategory(),
    weeklyMovement(),
    needsAttention(),
    recentMovements(),
  ]);
  return { snapshot, valueByCategory: categories, weekly, attention, recent };
}
