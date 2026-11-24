import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryMovement, Project } from "@/server/models";
import { monthKeyIST, startOfMonthIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { ProjectStatus } from "@/lib/constants";
import type { MonthPoint, ProjectUseRow } from "../types";

/**
 * Month-by-month stock history for charts, read from the movement ledger. Use is counted as in
 * the shared analytics core: assigned less returned, wastage on its own line. Value is the cost
 * the ledger recorded on each movement.
 */

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

type Scope = { itemIds?: string[] | null; projectId?: string | null };

const scopeMatch = (scope: Scope) => ({
  ...(scope.itemIds ? { item: { $in: scope.itemIds.map((id) => new Types.ObjectId(id)) } } : {}),
  ...(scope.projectId ? { project: new Types.ObjectId(scope.projectId) } : {}),
});

/** "2026-11" keys from the month of `from` to the month of `to`, oldest first. */
export function monthKeys(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = monthKeyIST(to);
  for (let i = 0; i < 600; i++) {
    const key = monthKeyIST(startOfMonthIST(from, i));
    out.push(key);
    if (key >= last) break;
  }
  return out;
}

/** Use, wastage and adjustments per IST month between two instants, zero-filled. */
export async function monthlyMovements(from: Date, to: Date, scope: Scope = {}): Promise<MonthPoint[]> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{
    _id: { month: string; type: string; up: boolean };
    qty: number;
    value: number;
    n: number;
  }>([
    { $match: { date: { $gte: from, $lte: to }, type: { $in: ["assign", "return", "wastage", "adjustment"] }, ...scopeMatch(scope) } },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } },
          type: "$type",
          up: { $gt: ["$availableDelta", 0] },
        },
        qty: { $sum: "$quantity" },
        value: { $sum: { $ifNull: ["$totalCost", 0] } },
        n: { $sum: 1 },
      },
    },
  ]);
  const byMonth = new Map<string, MonthPoint>(
    monthKeys(from, to).map((m) => [m, { month: m, consumedValue: 0, consumedQty: 0, wastedValue: 0, wastedQty: 0, wastageCount: 0, adjustmentsUp: 0, adjustmentsDown: 0 }]),
  );
  for (const r of rows) {
    const p = byMonth.get(r._id.month);
    if (!p) continue;
    if (r._id.type === "assign") {
      p.consumedQty += r.qty;
      p.consumedValue += r.value;
    } else if (r._id.type === "return") {
      p.consumedQty -= r.qty;
      p.consumedValue -= r.value;
    } else if (r._id.type === "wastage") {
      p.wastedQty += r.qty;
      p.wastedValue += r.value;
      p.wastageCount += r.n;
    } else if (r._id.up) p.adjustmentsUp += r.n;
    else p.adjustmentsDown += r.n;
  }
  return [...byMonth.values()].map((p) => ({
    ...p,
    consumedQty: round3(p.consumedQty),
    consumedValue: round2(p.consumedValue),
    wastedQty: round3(p.wastedQty),
    wastedValue: round2(p.wastedValue),
  }));
}

/** The first day stock was ever assigned to a project (in scope), for the seasonal-history check. */
export async function firstAssignment(scope: Scope = {}): Promise<Date | null> {
  await connectDB();
  const row = await InventoryMovement.findOne({ type: "assign", ...scopeMatch(scope) }, { date: 1 }).sort({ date: 1 }).lean();
  return row?.date ?? null;
}

/** Whole months between two instants (by IST calendar month). */
export function monthsBetween(from: Date, to: Date): number {
  const [fy, fm] = monthKeyIST(from).split("-").map(Number);
  const [ty, tm] = monthKeyIST(to).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Value of stock each project consumed in the window (assigned less returned), largest first. */
export async function projectUseInWindow(from: Date, to: Date, itemIds?: string[] | null): Promise<ProjectUseRow[]> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; value: number; items: Types.ObjectId[] }>([
    {
      $match: {
        date: { $gte: from, $lte: to },
        type: { $in: ["assign", "return"] },
        project: { $ne: null },
        ...scopeMatch({ itemIds }),
      },
    },
    {
      $group: {
        _id: "$project",
        value: { $sum: { $cond: [{ $eq: ["$type", "assign"] }, { $ifNull: ["$totalCost", 0] }, { $multiply: [-1, { $ifNull: ["$totalCost", 0] }] }] } },
        items: { $addToSet: "$item" },
      },
    },
  ]);
  if (!rows.length) return [];
  const projects = await Project.find({ _id: { $in: rows.map((r) => r._id) } }, { name: 1, code: 1, color: 1, status: 1 }).lean();
  const byId = new Map(projects.map((p) => [String(p._id), p]));
  return rows
    .map((r) => {
      const p = byId.get(String(r._id));
      return {
        projectId: String(r._id),
        name: p?.name ?? "Deleted project",
        code: p?.code ?? "",
        color: p?.color ?? "#4a82cc",
        status: (p?.status ?? "active") as ProjectStatus,
        materials: r.items.length,
        value: round2(Math.max(0, r.value)),
      };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

export type ItemWastage = {
  /** Cost of all units written off. */
  value: number;
  /** Units written off from storage. Units wasted on a project were already counted as used there. */
  fromStorage: number;
};

/**
 * Value of stock wasted per item in the window, and the units that came from storage. With a
 * project, only write-offs of units in use on that project (storage write-offs carry no project),
 * so the value matches that project's wasted units from usageByItem.
 */
export async function wastageByItem(from: Date, to: Date, projectId?: string | null): Promise<Map<string, ItemWastage>> {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: Types.ObjectId; value: number; fromStorage: number }>([
    { $match: { date: { $gte: from, $lte: to }, type: "wastage", ...(projectId ? { project: new Types.ObjectId(projectId) } : {}) } },
    {
      $group: {
        _id: "$item",
        value: { $sum: { $ifNull: ["$totalCost", 0] } },
        // Older write-offs carry no origin; they could only come from storage then.
        fromStorage: { $sum: { $cond: [{ $eq: ["$wastage.from", "project"] }, 0, "$quantity"] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { value: round2(r.value), fromStorage: round3(r.fromStorage) }]));
}

/** IST midnight at the start of the month `months` months before `date`'s month. */
export const monthsBack = (date: Date, months: number) => startOfMonthIST(date, -months);
