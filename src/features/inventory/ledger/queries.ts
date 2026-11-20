import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryAllocation, InventoryItem, InventoryMovement, Project } from "@/server/models";
import { getProjectOptions } from "@/server/lookups";
import { roundQty } from "@/server/services/inventory-ledger";
import { projectSpend } from "@/server/services/metrics";
import { iso } from "@/server/serialize";
import { round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import { GST_RATES } from "@/config/company";
import type { MovementType, ProjectStage } from "@/lib/constants";
import type { HeldItem, LastPurchase, LedgerItem, LedgerProject, ProjectImpact, RecentOperation } from "./types";

export async function getLedgerItems(): Promise<LedgerItem[]> {
  await connectDB();
  const items = await InventoryItem.find({ archivedAt: null }).sort({ name: 1 }).lean();
  // Rounded to the ledger's 3 decimals so float drift stored by older writes
  // (0.19999999999999998 kg) does not make the forms refuse the 0.2 they show.
  return items.map((i) => ({
    id: String(i._id),
    name: i.name,
    sku: i.sku,
    unit: i.unit ?? "pcs",
    available: roundQty(i.available),
    allocated: roundQty(i.allocated),
    quantity: roundQty(i.quantity),
    minStock: i.minStock,
    unitPrice: i.unitPrice,
    lastPurchasePrice: i.lastPurchasePrice ?? null,
    vendor: i.vendor ?? null,
    status: getStockStatus(roundQty(i.available), i.minStock),
  }));
}

type StoredInvoice = { gstin?: string | null; hsnSac?: string | null; taxableAmount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null };

/** The standard GST rate a bill was taxed at, or null when there is no tax base or it matches no standard rate. */
export function gstRateOf(invoice: StoredInvoice | null | undefined): number | null {
  const taxable = invoice?.taxableAmount ?? 0;
  if (!(taxable > 0)) return null;
  const percent = (((invoice?.cgst ?? 0) + (invoice?.sgst ?? 0) + (invoice?.igst ?? 0)) / taxable) * 100;
  // Within a quarter percent: suppliers round each head to the rupee or paisa.
  const rate = GST_RATES.find((r) => Math.abs(r - percent) <= 0.25);
  return rate ?? null;
}

/** Each item's most recent purchase (latest date, then latest entry), for the purchase form to fill from. */
export async function getLastPurchases(): Promise<Record<string, LastPurchase>> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; date: Date; vendor?: string | null; invoice?: StoredInvoice | null }>([
    { $match: { type: "purchase" } },
    { $sort: { item: 1, date: -1, _id: -1 } },
    { $group: { _id: "$item", date: { $first: "$date" }, vendor: { $first: "$vendor" }, invoice: { $first: "$invoice" } } },
  ]);
  const out: Record<string, LastPurchase> = {};
  for (const r of rows) {
    out[String(r._id)] = {
      date: iso(r.date)!,
      vendor: r.vendor?.trim() || null,
      gstin: r.invoice?.gstin?.trim() || null,
      hsnSac: r.invoice?.hsnSac?.trim() || null,
      rate: gstRateOf(r.invoice),
    };
  }
  return out;
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
    entry.held = roundQty(entry.held + a.quantity);
    // Each lot rounded to paise, as its expense and the return credit are, so the value shown
    // next to "Credit to project" matches what returning everything would credit.
    entry.cost = round2(entry.cost + round2(a.quantity * a.unitCost));
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
  return { budget: project.budget, spent: s?.spent ?? 0, byStage: s?.byStage ?? {}, salariesHidden: s?.salariesHidden ?? false };
}
