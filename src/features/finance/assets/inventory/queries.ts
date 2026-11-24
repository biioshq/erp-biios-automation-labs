import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryAllocation, InventoryCategory, InventoryItem, InventoryMovement, Project } from "@/server/models";
import { roundQty } from "@/server/services/inventory-ledger";
import { effectiveAsOf, ledgerAsOf } from "@/server/accounting/ledger";
import { lookAheadAlerts } from "@/server/analytics/core";
import { getStockStatus } from "@/lib/stock-status";
import { DEPARTMENTS, labelOf, WASTAGE_REASONS, type Department, type ProjectStage, type ProjectStatus, type WastageReason } from "@/lib/constants";
import { endOfDayIST, financialYearIST, fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { Posting } from "@/lib/accounting";
import type {
  AlertRow,
  Flow,
  InUseRow,
  InventoryValuation,
  PeriodItemRow,
  PeriodSummary,
  ProjectInUse,
  StorageRow,
  WastedRow,
} from "./types";

/**
 * Inventory as an asset, read from Inventory's own records (items, assignments, movements) and the
 * accounting engine; nothing here writes. Stock in storage is valued at weighted average cost
 * (available × the item's average unit price). Stock in use is what open assignments still hold,
 * less units wasted on the project, at the cost they were assigned at.
 */

const DEFAULT_COLOR = "#4a82cc";
const flow = (quantity = 0, value = 0): Flow => ({ quantity: roundQty(quantity), value: round2(value) });

type ItemInfo = { name: string; sku: string; unit: string; category: string | null; location: string | null; archived: boolean };

async function loadItems() {
  const [items, categories] = await Promise.all([
    InventoryItem.find(
      {},
      { name: 1, sku: 1, unit: 1, category: 1, available: 1, minStock: 1, unitPrice: 1, location: 1, purchaseDate: 1, archivedAt: 1 },
    ).lean(),
    InventoryCategory.find({}, { name: 1 }).lean(),
  ]);
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
  const info = new Map<string, ItemInfo>();
  for (const i of items) {
    info.set(String(i._id), {
      name: i.name,
      sku: i.sku,
      unit: i.unit ?? "pcs",
      category: i.category ? (categoryName.get(String(i.category)) ?? null) : null,
      location: i.location ?? null,
      archived: Boolean(i.archivedAt),
    });
  }
  return { items, info };
}

async function storageRows(items: Awaited<ReturnType<typeof loadItems>>["items"], info: Map<string, ItemInfo>): Promise<InventoryValuation["storage"]> {
  const lastIn = await InventoryMovement.aggregate<{ _id: Types.ObjectId; last: Date }>([
    { $match: { type: "purchase" } },
    { $group: { _id: "$item", last: { $max: "$date" } } },
  ]);
  const lastInBy = new Map(lastIn.map((r) => [String(r._id), r.last]));
  const rows: StorageRow[] = [];
  let outOfStock = 0;
  let active = 0;
  for (const i of items) {
    if (i.archivedAt) continue;
    active += 1;
    const id = String(i._id);
    // 3-decimal quantities, as the ledger keeps them, so stored drift (5.55e-17) reads as none.
    const quantity = roundQty(i.available ?? 0);
    if (quantity <= 0) {
      outOfStock += 1;
      continue;
    }
    const meta = info.get(id)!;
    const last = lastInBy.get(id) ?? i.purchaseDate ?? null;
    rows.push({
      id,
      name: meta.name,
      sku: meta.sku,
      category: meta.category,
      quantity,
      unit: meta.unit,
      minStock: i.minStock ?? 0,
      unitPrice: i.unitPrice ?? 0,
      // Per item to the paisa before adding, as the inventory dashboard and reports do.
      value: round2((i.available ?? 0) * (i.unitPrice ?? 0)),
      location: meta.location,
      lastIn: last ? toDateInput(last) : null,
      status: getStockStatus(quantity, i.minStock ?? 0),
    });
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return {
    rows,
    quantity: roundQty(rows.reduce((s, r) => s + r.quantity, 0)),
    value: rows.reduce((s, r) => round2(s + r.value), 0),
    items: active,
    outOfStock,
  };
}

async function inUseRows(info: Map<string, ItemInfo>): Promise<InventoryValuation["inUse"]> {
  const allocations = await InventoryAllocation.find(
    { quantity: { $gt: 0 } },
    { project: 1, item: 1, quantity: 1, quantityWasted: 1, unitCost: 1, stage: 1, assignedAt: 1 },
  )
    .sort({ assignedAt: -1 })
    .lean();
  const projectIds = [...new Set(allocations.map((a) => String(a.project)))];
  const projects = await Project.find({ _id: { $in: projectIds } }, { name: 1, color: 1, status: 1 }).lean();
  const projectBy = new Map(projects.map((p) => [String(p._id), p]));
  const rows: InUseRow[] = [];
  const perProject = new Map<string, ProjectInUse>();
  for (const a of allocations) {
    const meta = info.get(String(a.item));
    // Archived items are left out, as on the inventory dashboard.
    if (!meta || meta.archived) continue;
    const wasted = roundQty(a.quantityWasted ?? 0);
    const quantity = roundQty(a.quantity - wasted);
    if (quantity <= 0) continue;
    const p = projectBy.get(String(a.project));
    const project = p ? { id: String(p._id), name: p.name, color: p.color ?? DEFAULT_COLOR, status: p.status as ProjectStatus } : null;
    const value = round2(quantity * a.unitCost);
    rows.push({
      id: String(a._id),
      itemId: String(a.item),
      name: meta.name,
      sku: meta.sku,
      category: meta.category,
      quantity,
      wasted,
      unit: meta.unit,
      unitCost: a.unitCost,
      value,
      project,
      stage: (a.stage as ProjectStage) ?? null,
      assignedAt: toDateInput(a.assignedAt),
    });
    const key = project?.id ?? "none";
    const t = perProject.get(key) ?? { id: key, name: project?.name ?? "Deleted project", color: project?.color ?? DEFAULT_COLOR, status: project?.status ?? "cancelled", lines: 0, value: 0 };
    t.lines += 1;
    t.value = round2(t.value + value);
    perProject.set(key, t);
  }
  return {
    rows,
    quantity: roundQty(rows.reduce((s, r) => s + r.quantity, 0)),
    value: rows.reduce((s, r) => round2(s + r.value), 0),
    projects: [...perProject.values()].sort((a, b) => b.value - a.value),
  };
}

async function wastedRows(info: Map<string, ItemInfo>, asOf: Date): Promise<InventoryValuation["wasted"]> {
  const fy = financialYearIST(asOf);
  const docs = await InventoryMovement.find(
    { type: "wastage", date: { $lte: asOf } },
    { item: 1, quantity: 1, unitCost: 1, totalCost: 1, project: 1, wastage: 1, date: 1, note: 1 },
  )
    .sort({ date: -1, _id: -1 })
    .lean();
  const projectIds = [...new Set(docs.map((m) => (m.project ? String(m.project) : null)).filter((p): p is string => Boolean(p)))];
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { name: 1 }).lean() : [];
  const projectName = new Map(projects.map((p) => [String(p._id), p.name]));
  let yearValue = 0;
  const rows: WastedRow[] = docs.map((m) => {
    const meta = info.get(String(m.item));
    const value = round2(m.totalCost ?? 0);
    if (m.date.getTime() >= fy.start.getTime()) yearValue = round2(yearValue + value);
    const from = m.wastage?.from === "project" ? "project" : "storage";
    const projectId = m.project ? String(m.project) : null;
    return {
      id: String(m._id),
      itemId: String(m.item),
      name: meta?.name ?? "Deleted item",
      sku: meta?.sku ?? "",
      category: meta?.category ?? null,
      quantity: roundQty(m.quantity),
      unit: meta?.unit ?? "pcs",
      unitCost: m.quantity > 0 ? round2(value / m.quantity) : (m.unitCost ?? 0),
      value,
      from,
      where: from === "project" ? (projectId ? (projectName.get(projectId) ?? "Deleted project") : null) : (m.wastage?.location ?? meta?.location ?? null),
      projectId,
      department: m.wastage?.department ? labelOf(DEPARTMENTS, m.wastage.department as Department) : null,
      responsible: m.wastage?.responsible ?? null,
      reason: m.wastage?.reason ? labelOf(WASTAGE_REASONS, m.wastage.reason as WastageReason) : "Not recorded",
      date: toDateInput(m.date),
      note: m.note ?? null,
    };
  });
  return {
    rows,
    quantity: roundQty(rows.reduce((s, r) => s + r.quantity, 0)),
    value: rows.reduce((s, r) => round2(s + r.value), 0),
    yearValue,
    yearLabel: fy.label,
  };
}

/**
 * Units in storage per item at a moment: the sum of every change to `available` before it. Not the
 * last movement's balance snapshot: a backdated movement is saved after later-dated ones, so
 * snapshots follow the order of entry, not the order of dates.
 */
async function levelsAt(before: Date, inclusive: boolean): Promise<Map<string, number>> {
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; available: number }>([
    { $match: { date: inclusive ? { $lte: before } : { $lt: before } } },
    { $group: { _id: "$item", available: { $sum: "$availableDelta" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), roundQty(r.available ?? 0)]));
}

type Bucket = "purchases" | "issued" | "returned" | "wastage" | "adjustments";

/**
 * Ids of the movements that are halves of a move between projects (moveBetweenProjects): a return
 * that names an allocation, and the assignment into that same allocation. A plain return names no
 * allocation, and a plain assignment's allocation is its own, so neither matches.
 */
function moveHalves(movements: { _id: unknown; type: string; allocation?: unknown }[]): Set<string> {
  const into = new Set(movements.filter((m) => m.type === "return" && m.allocation).map((m) => String(m.allocation)));
  return new Set(
    movements.filter((m) => (m.type === "return" || m.type === "assign") && m.allocation && into.has(String(m.allocation))).map((m) => String(m._id)),
  );
}

/**
 * Inventory account values for the period from the accounting engine, so opening and closing
 * stock agree with the balance sheet on those days. Each posting is sorted by what caused it.
 */
async function bookValues(from: Date, to: Date) {
  const ledger = await ledgerAsOf(to);
  const start = from.getTime();
  const postings = ledger.postings.filter((p) => p.account === "inventory");
  const inPeriod = postings.filter((p) => p.date.getTime() >= start);
  const movementIds = [...new Set(inPeriod.filter((p) => p.source.kind === "movement").map((p) => p.source.id))];
  const docs = movementIds.length ? await InventoryMovement.find({ _id: { $in: movementIds } }, { type: 1, allocation: 1 }).lean() : [];
  const types = new Map(docs.map((m) => [String(m._id), m.type]));
  const moves = moveHalves(docs);
  const bucketOf = (p: Posting): Bucket => {
    if (p.source.kind !== "movement") return "purchases";
    // Both halves of a project-to-project move carry the same value, so they net to nothing.
    if (moves.has(p.source.id)) return "adjustments";
    switch (types.get(p.source.id)) {
      case "purchase":
        return "purchases";
      case "assign":
        return "issued";
      case "return":
        return "returned";
      case "wastage":
        return "wastage";
      default:
        return "adjustments";
    }
  };
  const values: Record<Bucket, number> = { purchases: 0, issued: 0, returned: 0, wastage: 0, adjustments: 0 };
  for (const p of inPeriod) {
    const b = bucketOf(p);
    // Outflows are shown as positive amounts; adjustments keep their sign.
    values[b] = round2(values[b] + (b === "issued" || b === "wastage" ? -p.amount : p.amount));
  }
  const opening = round2(postings.filter((p) => p.date.getTime() < start).reduce((s, p) => s + p.amount, 0));
  const closing = round2(postings.reduce((s, p) => s + p.amount, 0));
  return { opening, closing, values, today: ledger.asOf };
}

async function periodSummary(from: Date, to: Date, info: Map<string, ItemInfo>): Promise<{ period: PeriodSummary; items: PeriodItemRow[] }> {
  const [movements, opening, closing, book] = await Promise.all([
    InventoryMovement.find({ date: { $gte: from, $lte: to } }, { item: 1, type: 1, quantity: 1, availableDelta: 1, totalCost: 1, wastage: 1, allocation: 1 }).lean(),
    levelsAt(from, false),
    levelsAt(to, true),
    bookValues(from, to),
  ]);
  const perItem = new Map<string, PeriodItemRow>();
  const row = (id: string): PeriodItemRow => {
    let r = perItem.get(id);
    if (!r) {
      const meta = info.get(id);
      r = {
        id,
        name: meta?.name ?? "Deleted item",
        sku: meta?.sku ?? "",
        unit: meta?.unit ?? "pcs",
        opening: opening.get(id) ?? 0,
        purchased: 0,
        purchasedValue: 0,
        issued: 0,
        issuedValue: 0,
        returned: 0,
        wasted: 0,
        wastedValue: 0,
        adjusted: 0,
        closing: closing.get(id) ?? 0,
      };
      perItem.set(id, r);
    }
    return r;
  };
  const q = { purchases: 0, issued: 0, returned: 0, wastage: 0, adjustments: 0 };
  const inUseWaste = { quantity: 0, value: 0 };
  const moved = { quantity: 0, value: 0 };
  const moves = moveHalves(movements);
  for (const m of movements) {
    const r = row(String(m.item));
    if (moves.has(String(m._id))) {
      // Storage only sees the units pass through (+n then -n); count the move once, by its return half.
      if (m.type === "return") {
        moved.quantity += m.quantity;
        moved.value = round2(moved.value + (m.totalCost ?? 0));
      }
      continue;
    }
    // Storage flows from the signed change to `available`, so opening + flows = closing exactly.
    const delta = m.availableDelta ?? 0;
    const cost = m.totalCost ?? 0;
    switch (m.type) {
      case "purchase":
        q.purchases += delta;
        r.purchased += delta;
        r.purchasedValue = round2(r.purchasedValue + cost);
        break;
      case "assign":
        q.issued -= delta;
        r.issued -= delta;
        r.issuedValue = round2(r.issuedValue + cost);
        break;
      case "return":
        q.returned += delta;
        r.returned += delta;
        break;
      case "wastage":
        if (m.wastage?.from === "project") {
          inUseWaste.quantity += m.quantity;
          inUseWaste.value = round2(inUseWaste.value + cost);
        } else {
          q.wastage -= delta;
          r.wasted -= delta;
          r.wastedValue = round2(r.wastedValue + cost);
        }
        break;
      default:
        q.adjustments += delta;
        r.adjusted += delta;
    }
  }
  // Items holding stock at either end show even without movements in the period.
  for (const [id, qty] of [...opening, ...closing]) if (qty > 0) row(id);
  const sumLevels = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

  const items = [...perItem.values()]
    .map((r) => ({
      ...r,
      purchased: roundQty(r.purchased),
      issued: roundQty(r.issued),
      returned: roundQty(r.returned),
      wasted: roundQty(r.wasted),
      adjusted: roundQty(r.adjusted),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    period: {
      from: toDateInput(from),
      to: toDateInput(book.today.getTime() < to.getTime() ? book.today : to),
      opening: flow(sumLevels(opening), book.opening),
      purchases: flow(q.purchases, book.values.purchases),
      issued: flow(q.issued, book.values.issued),
      returned: flow(q.returned, book.values.returned),
      wastage: flow(q.wastage, book.values.wastage),
      adjustments: flow(q.adjustments, book.values.adjustments),
      closing: flow(sumLevels(closing), book.closing),
      wastedInUse: flow(inUseWaste.quantity, inUseWaste.value),
      movedBetweenProjects: flow(moved.quantity, moved.value),
      movementCount: movements.length,
    },
    items,
  };
}

async function alertRows(): Promise<AlertRow[]> {
  const alerts = await lookAheadAlerts();
  return alerts.map((a) => ({
    id: a.id,
    name: a.name,
    sku: a.sku,
    unit: a.unit,
    available: roundQty(a.available),
    minStock: a.minStock,
    leadTimeDays: a.leadTimeDays,
    level: a.level,
    reasons: a.reasons,
    daysOfCover: a.daysOfCover,
    orderBy: a.orderBy,
    suggestedQty: a.suggestedQty,
  }));
}

/** The selected period, from "yyyy-mm-dd" inputs: this financial year to date by default, never past today. */
export function inventoryPeriod(from?: string | null, to?: string | null): { from: Date; to: Date } {
  const today = effectiveAsOf(null);
  const f = from ? fromDateInput(from) : financialYearIST(today).start;
  const t = to ? endOfDayIST(fromDateInput(to)) : today;
  const end = t.getTime() > today.getTime() ? today : t;
  return { from: startOfDayIST(f.getTime() > end.getTime() ? end : f), to: end };
}

export async function getInventoryValuation(fromInput?: string | null, toInput?: string | null): Promise<InventoryValuation> {
  await connectDB();
  const { from, to } = inventoryPeriod(fromInput, toInput);
  const today = effectiveAsOf(null);
  const { items, info } = await loadItems();
  const [storage, inUse, wasted, period, alerts, bookToday] = await Promise.all([
    storageRows(items, info),
    inUseRows(info),
    wastedRows(info, today),
    periodSummary(from, to, info),
    alertRows(),
    // Same day key as the period's ledger when the period ends today, so the books are built once.
    ledgerAsOf(today).then((l) => round2(l.postings.reduce((s, p) => (p.account === "inventory" ? s + p.amount : s), 0))),
  ]);
  return { asOf: toDateInput(today), storage, inUse, wasted, bookValue: bookToday, period: period.period, periodItems: period.items, alerts };
}
