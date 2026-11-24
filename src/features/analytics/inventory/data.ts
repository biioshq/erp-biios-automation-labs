import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem, InventoryMovement, Project } from "@/server/models";
import type { Department, MovementType } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { isOpeningOnHand } from "@/lib/inventory-opening";

/**
 * Reads shared by the inventory analytics pages: movements in a period, and names for items and
 * projects. Read-only; nothing here writes to the database.
 */

export type MovementFact = {
  id: string;
  item: string;
  type: MovementType;
  quantity: number;
  availableDelta: number;
  totalCost: number;
  project: string | null;
  /** IST calendar day, "yyyy-mm-dd". */
  day: string;
  date: Date;
  /** Return half of a move between projects (the ledger sets `allocation` on it; plain returns have none). */
  moveHalf: boolean;
  wastageFrom: "storage" | "project" | null;
  department: Department | null;
  note: string | null;
  balanceAvailable: number | null;
  /** Opening stock entered as already on hand: not bought in the period, and its real purchase date is unknown. */
  openingOnHand: boolean;
};

/** Opening stock already on hand: a "purchase" that records when stock was entered, not bought (src/lib/inventory-opening.ts). */
const openingOnHandOf = (r: { type: string; openingOnHand?: boolean | null; note?: string | null }) => r.type === "purchase" && isOpeningOnHand(r);

type RawMovement = {
  _id: Types.ObjectId;
  item: Types.ObjectId;
  type: MovementType;
  quantity: number;
  availableDelta: number;
  totalCost?: number | null;
  project?: Types.ObjectId | null;
  allocation?: Types.ObjectId | null;
  date: Date;
  wastage?: { from: "storage" | "project"; department?: Department | null } | null;
  note?: string | null;
  openingOnHand?: boolean | null;
  balance?: { available: number } | null;
};

/**
 * Every movement dated inside [start, end], oldest first. A move between projects is a return
 * with `allocation` set plus an assignment that carries the same allocation; both halves are
 * flagged so totals can say how much of the issued stock only changed project.
 */
export async function loadMovements(start: Date, end: Date, itemId?: string): Promise<MovementFact[]> {
  await connectDB();
  const rows = await InventoryMovement.find(
    { date: { $gte: start, $lte: end }, ...(itemId ? { item: new Types.ObjectId(itemId) } : {}) },
    { item: 1, type: 1, quantity: 1, availableDelta: 1, totalCost: 1, project: 1, allocation: 1, date: 1, wastage: 1, note: 1, openingOnHand: 1, "balance.available": 1 },
  )
    .sort({ date: 1, _id: 1 })
    .lean<RawMovement[]>();
  const moveAllocations = new Set(rows.filter((r) => r.type === "return" && r.allocation).map((r) => String(r.allocation)));
  return rows.map((r) => ({
    id: String(r._id),
    item: String(r.item),
    type: r.type,
    quantity: r.quantity ?? 0,
    availableDelta: r.availableDelta ?? 0,
    totalCost: r.totalCost ?? 0,
    project: r.project ? String(r.project) : null,
    day: toDateInput(r.date),
    date: r.date,
    moveHalf: (r.type === "return" || r.type === "assign") && Boolean(r.allocation) && moveAllocations.has(String(r.allocation)),
    wastageFrom: r.wastage?.from ?? null,
    department: r.wastage?.department ?? null,
    note: r.note ?? null,
    balanceAvailable: typeof r.balance?.available === "number" ? r.balance.available : null,
    openingOnHand: openingOnHandOf(r),
  }));
}

export type ItemName = { id: string; name: string; sku: string; unit: string; archived: boolean };

/** Names of every item, archived ones included (their old movements still count). */
export async function itemNames(): Promise<Map<string, ItemName>> {
  await connectDB();
  const items = await InventoryItem.find({}, { name: 1, sku: 1, unit: 1, archivedAt: 1 }).lean();
  return new Map(
    items.map((i) => [String(i._id), { id: String(i._id), name: i.name, sku: i.sku, unit: i.unit ?? "pcs", archived: Boolean(i.archivedAt) }]),
  );
}

export type ProjectName = { id: string; name: string; code: string; color: string; status: string };

export async function projectNames(): Promise<Map<string, ProjectName>> {
  await connectDB();
  const projects = await Project.find({}, { name: 1, code: 1, color: 1, status: 1 }).lean();
  return new Map(
    projects.map((p) => [String(p._id), { id: String(p._id), name: p.name, code: p.code, color: p.color ?? "#4a82cc", status: p.status }]),
  );
}

/** The last day each item was issued to a project, over all records. */
export async function lastIssueDays(): Promise<Map<string, string>> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; last: Date }>([
    { $match: { type: "assign" } },
    { $group: { _id: "$item", last: { $max: "$date" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), toDateInput(r.last)]));
}

/**
 * The first day each item has any movement, over all records: from when the ERP knows its stock.
 * An item first recorded inside a window cannot be judged on that whole window (no use in 90 days
 * says little about stock entered last week).
 */
export async function firstMovementDays(): Promise<Map<string, string>> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; first: Date }>([{ $group: { _id: "$item", first: { $min: "$date" } } }]);
  return new Map(rows.map((r) => [String(r._id), toDateInput(r.first)]));
}

/** Round a quantity to 3 decimals, as the ledger stores them. */
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
