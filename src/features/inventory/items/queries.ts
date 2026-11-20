import "server-only";

import { cache } from "react";
import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/server/db";
import {
  InventoryAllocation,
  InventoryCategory,
  InventoryItem,
  InventoryMovement,
  type InventoryItemDoc,
} from "@/server/models";
import { roundQty } from "@/server/services/inventory-ledger";
import { iso } from "@/server/serialize";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { STOCK_STATUSES, type InventoryUnit, type MovementType, type StockStatus } from "@/lib/constants";
import { getStockStatus, stockStatusFilter } from "@/lib/stock-status";
import { round2 } from "@/lib/format";
import { toDateInput } from "@/lib/dates";
import { cleanAttributes, variantHint } from "./attributes";
import type {
  ItemAllocationRow,
  ItemCategoryRef,
  ItemDetail,
  ItemFormRecord,
  ItemMovementRow,
  ItemMovementSummary,
  ItemPurchasePoint,
  ItemRow,
} from "./types";

const DEFAULT_COLOR = "#4a82cc";
const STATUS_VALUES = new Set<string>(STOCK_STATUSES.map((s) => s.value));

type ItemLean = InventoryItemDoc & { createdAt?: Date; updatedAt?: Date };

function toRow(i: ItemLean, categories: Map<string, ItemCategoryRef>): ItemRow {
  const category = i.category ? (categories.get(String(i.category)) ?? null) : null;
  return {
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    unit: (i.unit ?? "pcs") as InventoryUnit,
    category,
    subcategory: i.subcategory || null,
    variant: variantHint({ attributes: i.attributes, subcategory: null }),
    // Rounded to the ledger's 3 decimals, as the Assign and Return forms do, so float drift that
    // older writes stored (5.55e-17) shows as 0 and Out of Stock on every screen.
    available: roundQty(i.available),
    allocated: roundQty(i.allocated),
    quantity: roundQty(i.quantity),
    minStock: i.minStock,
    unitPrice: i.unitPrice,
    value: round2(i.available * i.unitPrice),
    vendor: i.vendor ?? null,
    location: i.location ?? null,
    status: getStockStatus(roundQty(i.available), i.minStock),
    photoFileId: i.photoFileId ? String(i.photoFileId) : null,
    photoUrl: i.photoFileId ? `/api/files/${String(i.photoFileId)}` : null,
    updatedAt: iso(i.updatedAt)!,
  };
}

async function categoryMap(ids?: (Types.ObjectId | undefined)[]) {
  const cats = await (ids ? InventoryCategory.find({ _id: { $in: ids.filter((id): id is Types.ObjectId => Boolean(id)) } }) : InventoryCategory.find()).lean();
  return new Map<string, ItemCategoryRef>(
    cats.map((c) => [String(c._id), { id: String(c._id), name: c.name, color: c.color ?? DEFAULT_COLOR }]),
  );
}

/** Mongo filter from list params (active items only). */
export function itemFilter(params: Pick<ListParams, "q" | "filters">): Record<string, unknown> {
  const filter: Record<string, unknown> = { archivedAt: null };
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    filter.$or = [{ name: re }, { sku: re }, { vendor: re }, { subcategory: re }, { "attributes.value": re }, { description: re }];
  }
  const statuses = (filters.status ?? []).filter((s) => STATUS_VALUES.has(s)) as StockStatus[];
  if (statuses.length) filter.$and = [{ $or: statuses.map(stockStatusFilter) }];
  if (filters.category?.length) {
    const ids = filters.category.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    filter.category = { $in: filters.category.includes("none") ? [...ids, null] : ids };
  }
  if (filters.vendor?.length) filter.vendor = { $in: filters.vendor };
  if (filters.subcategory?.length) {
    const named = filters.subcategory.filter((s) => s !== "none");
    filter.subcategory = filters.subcategory.includes("none") ? { $in: [...named, null, ""] } : { $in: named };
  }
  return filter;
}

export async function listItems(params: ListParams): Promise<Paginated<ItemRow>> {
  await connectDB();
  const filter = itemFilter(params);
  const sort = mongoSort(params.sort ?? { id: "name", desc: false });
  const pipeline: PipelineStage[] = [
    { $match: filter as PipelineStage.Match["$match"] },
    { $addFields: { value: { $multiply: ["$available", "$unitPrice"] } } },
    { $sort: sort },
    { $skip: (params.page - 1) * params.pageSize },
    { $limit: params.pageSize },
  ];
  const [docs, total, categories] = await Promise.all([
    InventoryItem.aggregate<ItemLean>(pipeline).collation({ locale: "en", strength: 2 }),
    InventoryItem.countDocuments(filter as never),
    categoryMap(),
  ]);
  return { rows: docs.map((d) => toRow(d, categories)), total, page: params.page, pageSize: params.pageSize };
}

/** Distinct subcategories of active items, for the list filter and the item form's suggestions. */
export async function getItemSubcategories(): Promise<string[]> {
  await connectDB();
  const names = (await InventoryItem.distinct("subcategory", { archivedAt: null })) as (string | null)[];
  return names.filter((v): v is string => Boolean(v)).sort((a, b) => a.localeCompare(b));
}

/** Distinct vendors of active items, for the list filter. */
export async function getItemVendors(): Promise<string[]> {
  await connectDB();
  const vendors = (await InventoryItem.distinct("vendor", { archivedAt: null })) as (string | null)[];
  return vendors.filter((v): v is string => Boolean(v)).sort((a, b) => a.localeCompare(b));
}

function toFormRecord(i: ItemLean): ItemFormRecord {
  return {
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    categoryId: i.category ? String(i.category) : null,
    subcategory: i.subcategory || null,
    attributes: cleanAttributes(i.attributes),
    unit: (i.unit ?? "pcs") as InventoryUnit,
    minStock: i.minStock,
    vendor: i.vendor ?? null,
    purchaseDate: i.purchaseDate ? toDateInput(i.purchaseDate) : null,
    description: i.description ?? null,
    location: i.location ?? null,
    updatedAt: iso(i.updatedAt)!,
  };
}

export async function getItemForm(id: string): Promise<ItemFormRecord | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const item = await InventoryItem.findOne({ _id: id, archivedAt: null }).lean<ItemLean>();
  return item ? toFormRecord(item) : null;
}

type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null;
type PopulatedUser = { _id: Types.ObjectId; name?: string } | null;

/** Cached per request: the page and its metadata both read it. */
export const getItemDetail = cache(async (id: string): Promise<ItemDetail | null> => {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const item = await InventoryItem.findOne({ _id: id, archivedAt: null }).lean<ItemLean>();
  if (!item) return null;

  const [categories, movementDocs, totals, allocationDocs, purchaseDocs] = await Promise.all([
    categoryMap(item.category ? [item.category] : []),
    InventoryMovement.find({ item: item._id })
      .sort({ date: -1, _id: -1 })
      .limit(50)
      .populate("project", "name code color")
      .populate("createdBy", "name")
      .lean(),
    InventoryMovement.aggregate<{ _id: MovementType; quantity: number; delta: number; count: number }>([
      { $match: { item: item._id } },
      { $group: { _id: "$type", quantity: { $sum: "$quantity" }, delta: { $sum: "$availableDelta" }, count: { $sum: 1 } } },
    ]),
    InventoryAllocation.find({ item: item._id, quantity: { $gt: 0 } })
      .populate("project", "name code color")
      .lean(),
    InventoryMovement.find({ item: item._id, type: "purchase" }).sort({ date: -1, _id: -1 }).limit(12).lean(),
  ]);

  const movements: ItemMovementRow[] = movementDocs.map((m) => {
    const project = m.project as unknown as PopulatedProject;
    const user = m.createdBy as unknown as PopulatedUser;
    return {
      id: String(m._id),
      type: m.type as MovementType,
      quantity: m.quantity,
      availableDelta: m.availableDelta,
      project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? DEFAULT_COLOR } : null,
      remaining: m.balance?.available ?? 0,
      unitCost: m.unitCost ?? 0,
      totalCost: m.totalCost ?? 0,
      note: m.note ?? null,
      vendor: m.vendor ?? null,
      date: iso(m.date)!,
      user: user?.name ?? null,
    };
  });

  const byType = new Map(totals.map((t) => [t._id, t]));
  const summary: ItemMovementSummary = {
    purchased: byType.get("purchase")?.quantity ?? 0,
    assigned: byType.get("assign")?.quantity ?? 0,
    returned: byType.get("return")?.quantity ?? 0,
    adjusted: byType.get("adjustment")?.delta ?? 0,
    remaining: roundQty(item.available),
    count: totals.reduce((n, t) => n + t.count, 0),
  };

  const grouped = new Map<string, ItemAllocationRow>();
  for (const a of allocationDocs) {
    const project = a.project as unknown as PopulatedProject;
    if (!project?._id) continue;
    const key = String(project._id);
    const row = grouped.get(key) ?? {
      projectId: key,
      name: project.name,
      code: project.code,
      color: project.color ?? DEFAULT_COLOR,
      quantity: 0,
      cost: 0,
      lastAssignedAt: iso(a.assignedAt)!,
    };
    row.quantity = roundQty(row.quantity + a.quantity);
    // Per lot, as the project's expenses and the Return screen round it.
    row.cost = round2(row.cost + round2(a.quantity * a.unitCost));
    if (new Date(a.assignedAt) > new Date(row.lastAssignedAt)) row.lastAssignedAt = iso(a.assignedAt)!;
    grouped.set(key, row);
  }
  const allocations: ItemAllocationRow[] = [...grouped.values()].sort((a, b) => b.quantity - a.quantity);

  // Oldest first, so the trend chart reads left to right.
  const purchases: ItemPurchasePoint[] = purchaseDocs
    .map((p) => ({ id: String(p._id), date: iso(p.date)!, unitCost: p.unitCost ?? 0, quantity: p.quantity, vendor: p.vendor ?? null }))
    .reverse();

  return {
    ...toRow(item, categories),
    ...toFormRecord(item),
    lastPurchasePrice: item.lastPurchasePrice ?? null,
    createdAt: iso(item.createdAt)!,
    movementCount: summary.count,
    movements,
    summary,
    allocations,
    purchases,
  };
});
