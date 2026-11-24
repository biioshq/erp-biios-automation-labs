import "server-only";

import type { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem, InventoryMovement } from "@/server/models";
import { roundQty } from "@/server/services/inventory-ledger";
import { iso } from "@/server/serialize";
import type { ProjectStage } from "@/lib/constants";
import { variantHint } from "@/features/inventory/items/attributes";
import type { LocatedItem, ProjectMoveRow, RelocationRow } from "./types";

type PopulatedItem = { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
type PopulatedProject = { _id: Types.ObjectId; name: string; color?: string } | null;
type PopulatedUser = { _id: Types.ObjectId; name?: string } | null;
type PopulatedAllocation = { _id: Types.ObjectId; project: PopulatedProject; stage?: string } | null;

const DEFAULT_COLOR = "#4a82cc";

const itemRef = (item: PopulatedItem) =>
  item?._id ? { id: String(item._id), name: item.name, sku: item.sku, unit: item.unit ?? "pcs" } : { id: "", name: "Deleted item", sku: "", unit: "pcs" };

const projectRef = (p: PopulatedProject) => (p?._id ? { id: String(p._id), name: p.name, color: p.color ?? DEFAULT_COLOR } : null);

/**
 * Recent moves between projects. A move is recorded as a return from the first project and an
 * assignment to the second; the return carries `allocation`, the assignment the units went into
 * (plain returns never set it), so the return alone describes the whole move.
 */
export async function getRecentProjectMoves(limit = 8): Promise<ProjectMoveRow[]> {
  await connectDB();
  const docs = await InventoryMovement.find({ type: "return", allocation: { $exists: true, $ne: null } })
    .sort({ date: -1, _id: -1 })
    .limit(limit)
    .populate("item", "name sku unit")
    .populate("project", "name color")
    .populate({ path: "allocation", select: "project stage", populate: { path: "project", select: "name color" } })
    .populate("createdBy", "name")
    .lean();
  return docs.map((m) => {
    const allocation = m.allocation as unknown as PopulatedAllocation;
    return {
      id: String(m._id),
      date: iso(m.date)!,
      item: itemRef(m.item as unknown as PopulatedItem),
      quantity: m.quantity,
      from: projectRef(m.project as unknown as PopulatedProject),
      to: projectRef(allocation?.project ?? null),
      stage: (allocation?.stage as ProjectStage | undefined) ?? null,
      value: m.totalCost ?? 0,
      by: (m.createdBy as unknown as PopulatedUser)?.name ?? null,
    };
  });
}

/** Recent moves of items to another storage location. */
export async function getRecentRelocations(limit = 8): Promise<RelocationRow[]> {
  await connectDB();
  const docs = await InventoryMovement.find({ type: "transfer" })
    .sort({ date: -1, _id: -1 })
    .limit(limit)
    .populate("item", "name sku unit")
    .populate("createdBy", "name")
    .lean();
  return docs.map((m) => ({
    id: String(m._id),
    date: iso(m.date)!,
    item: itemRef(m.item as unknown as PopulatedItem),
    quantity: m.quantity,
    from: m.relocation?.from ?? null,
    to: m.relocation?.to ?? null,
    by: (m.createdBy as unknown as PopulatedUser)?.name ?? null,
    note: m.note ?? null,
  }));
}

/** Every active item with where it is kept, for the location form. */
export async function getLocatedItems(): Promise<LocatedItem[]> {
  await connectDB();
  const items = await InventoryItem.find({ archivedAt: null }, { name: 1, sku: 1, unit: 1, available: 1, location: 1, attributes: 1 })
    .sort({ name: 1 })
    .lean();
  return items.map((i) => ({
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    unit: i.unit ?? "pcs",
    available: roundQty(i.available),
    location: i.location?.trim() || null,
    variant: variantHint({ attributes: i.attributes, subcategory: null }, 30),
  }));
}
