import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem, InventoryMovement, type InventoryMovementDoc } from "@/server/models";
import { iso } from "@/server/serialize";
import { dateRangeFilter } from "@/lib/dates";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { round2 } from "@/lib/format";
import type { MovementType, ProjectStage, WastageReason } from "@/lib/constants";
import type { MovementRow, MovementSummary } from "./types";

type PopulatedItem = { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null;
type PopulatedUser = { _id: Types.ObjectId; name?: string } | null;

function toRow(m: InventoryMovementDoc): MovementRow {
  const item = m.item as unknown as PopulatedItem;
  const project = m.project as unknown as PopulatedProject;
  const by = m.createdBy as unknown as PopulatedUser;
  return {
    id: String(m._id),
    date: iso(m.date)!,
    type: m.type as MovementType,
    item: item?._id
      ? { id: String(item._id), name: item.name, sku: item.sku, unit: item.unit ?? "pcs" }
      : { id: "", name: "Deleted item", sku: "", unit: "pcs" },
    quantity: m.quantity,
    availableDelta: m.availableDelta,
    project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? "#4a82cc" } : null,
    stage: (m.stage as ProjectStage | undefined) ?? null,
    unitCost: m.unitCost ?? 0,
    totalCost: m.totalCost ?? 0,
    vendor: m.vendor ?? null,
    wastage: m.wastage ? { reason: m.wastage.reason as WastageReason, from: m.wastage.from === "project" ? "project" : "storage" } : null,
    relocation: m.relocation ? { from: m.relocation.from ?? null, to: m.relocation.to ?? null } : null,
    balance: { available: m.balance?.available ?? 0, allocated: m.balance?.allocated ?? 0 },
    by: by?.name ?? null,
    note: m.note ?? null,
  };
}

const objectIds = (values: string[]) => values.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

/** Mongo filter from list params. Exported so the inventory report can reuse the same filtering. */
export async function movementFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">): Promise<QueryFilter<InventoryMovementDoc>> {
  // Built loosely: Mongoose 9's strict filter types reject `$in` over lists parsed from the URL.
  const filter: Record<string, unknown> = {};
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    // Item name and SKU live on the item, so the search resolves them to ids first.
    const matching = await InventoryItem.find({ $or: [{ name: re }, { sku: re }] }, { _id: 1 }).limit(500).lean();
    filter.$or = [{ item: { $in: matching.map((i) => i._id) } }, { note: re }, { vendor: re }];
  }
  if (filters.type?.length) filter.type = { $in: filters.type };
  if (filters.project?.length) filter.project = { $in: objectIds(filters.project) };
  if (filters.item?.length) filter.item = { $in: objectIds(filters.item) };
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.date = range;
  return filter as QueryFilter<InventoryMovementDoc>;
}

const empty = () => ({ units: 0, value: 0, count: 0 });

export async function listMovements(params: ListParams): Promise<Paginated<MovementRow> & { summary: MovementSummary }> {
  await connectDB();
  const filter = await movementFilter(params);
  const [docs, total, grouped] = await Promise.all([
    InventoryMovement.find(filter)
      .sort(mongoSort(params.sort ?? { id: "date", desc: true }))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate("item", "name sku unit")
      .populate("project", "name code color")
      .populate("createdBy", "name")
      .lean(),
    InventoryMovement.countDocuments(filter),
    InventoryMovement.aggregate<{ _id: MovementType; units: number; value: number; count: number; net: number }>([
      { $match: filter },
      {
        $group: {
          _id: "$type",
          units: { $sum: "$quantity" },
          value: { $sum: "$totalCost" },
          count: { $sum: 1 },
          net: { $sum: "$availableDelta" },
        },
      },
    ]),
  ]);

  const summary: MovementSummary = { purchase: empty(), assign: empty(), return: empty(), adjustment: { ...empty(), net: 0 }, wastage: empty(), count: total };
  for (const g of grouped) {
    const totals = { units: g.units, value: round2(g.value), count: g.count };
    if (g._id === "adjustment") summary.adjustment = { ...totals, net: g.net };
    else if (g._id === "purchase" || g._id === "assign" || g._id === "return" || g._id === "wastage") summary[g._id] = totals;
  }

  return {
    rows: docs.map((d) => toRow(d as unknown as InventoryMovementDoc)),
    total,
    page: params.page,
    pageSize: params.pageSize,
    summary,
  };
}
