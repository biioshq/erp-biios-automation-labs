import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryAllocation, InventoryItem, InventoryMovement, Project } from "@/server/models";
import { getProjectOptions } from "@/server/lookups";
import { projectSpend } from "@/server/services/metrics";
import { iso } from "@/server/serialize";
import { getStockStatus } from "@/lib/stock-status";
import type { MovementType, ProjectStage } from "@/lib/constants";
import type { HeldItem, LedgerItem, LedgerProject, ProjectImpact, RecentOperation } from "./types";

export async function getLedgerItems(): Promise<LedgerItem[]> {
  await connectDB();
  const items = await InventoryItem.find({ archivedAt: null }).sort({ name: 1 }).lean();
  return items.map((i) => ({
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    unit: i.unit ?? "pcs",
    available: i.available,
    allocated: i.allocated,
    quantity: i.quantity,
    minStock: i.minStock,
    unitPrice: i.unitPrice,
    lastPurchasePrice: i.lastPurchasePrice ?? null,
    vendor: i.vendor ?? null,
    status: getStockStatus(i.available, i.minStock),
  }));
}

export async function getLedgerProjects(): Promise<LedgerProject[]> {
  const options = await getProjectOptions();
  return options.map((p) => ({ id: p.value, name: p.label, description: p.description, status: p.status, color: p.color }));
}

type PopulatedItem = { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
type PopulatedProject = { _id: Types.ObjectId; name: string; color?: string } | null;
type PopulatedUser = { _id: Types.ObjectId; name?: string } | null;

export async function getRecentOperations(type: MovementType, limit = 8): Promise<RecentOperation[]> {
  await connectDB();
  const docs = await InventoryMovement.find({ type })
    .sort({ date: -1, _id: -1 })
    .limit(limit)
    .populate("item", "name sku unit")
    .populate("project", "name color")
    .populate("createdBy", "name")
    .lean();
  return docs.map((m) => {
    const item = m.item as unknown as PopulatedItem;
    const project = m.project as unknown as PopulatedProject;
    const by = m.createdBy as unknown as PopulatedUser;
    return {
      id: String(m._id),
      type: m.type as MovementType,
      item: item?._id
        ? { id: String(item._id), name: item.name, sku: item.sku, unit: item.unit ?? "pcs" }
        : { id: "", name: "Deleted item", sku: "", unit: "pcs" },
      quantity: m.quantity,
      project: project?._id ? { id: String(project._id), name: project.name, color: project.color ?? "#4a82cc" } : null,
      stage: (m.stage as ProjectStage | undefined) ?? null,
      unitCost: m.unitCost ?? 0,
      totalCost: m.totalCost ?? 0,
      vendor: m.vendor ?? null,
      date: iso(m.date)!,
      createdAt: iso(m.createdAt as Date)!,
      by: by?.name ?? null,
    };
  });
}

/** Items a project currently holds, with the assignments to price a return (latest first). */
export async function getHeldItems(projectId: string): Promise<HeldItem[]> {
  if (!Types.ObjectId.isValid(projectId)) return [];
  await connectDB();
  const allocations = await InventoryAllocation.find({ project: new Types.ObjectId(projectId), quantity: { $gt: 0 } })
    .sort({ assignedAt: -1, _id: -1 })
    .populate("item", "name sku unit archivedAt")
    .lean();
  const byItem = new Map<string, HeldItem>();
  for (const a of allocations) {
    const item = a.item as unknown as (PopulatedItem & { archivedAt?: Date | null }) | null;
    if (!item?._id || item.archivedAt) continue;
    const id = String(item._id);
    const entry =
      byItem.get(id) ?? { itemId: id, name: item.name, sku: item.sku, unit: item.unit ?? "pcs", held: 0, cost: 0, lots: [] };
    entry.held += a.quantity;
    entry.cost += a.quantity * a.unitCost;
    entry.lots.push({ quantity: a.quantity, unitCost: a.unitCost, stage: a.stage as ProjectStage, assignedAt: iso(a.assignedAt)! });
    byItem.set(id, entry);
  }
  return [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProjectImpact(projectId: string): Promise<ProjectImpact | null> {
  if (!Types.ObjectId.isValid(projectId)) return null;
  await connectDB();
  const [project, spend] = await Promise.all([Project.findById(projectId, { budget: 1 }).lean(), projectSpend([projectId])]);
  if (!project) return null;
  const s = spend.get(projectId);
  return { budget: project.budget, spent: s?.spent ?? 0, byStage: s?.byStage ?? {} };
}
