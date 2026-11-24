import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryItem, InventoryMovement, type InventoryMovementDoc } from "@/server/models";
import { iso } from "@/server/serialize";
import { dateRangeFilter, financialYearIST } from "@/lib/dates";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { round2 } from "@/lib/format";
import { roundQty } from "@/server/services/inventory-ledger";
import type { Department, ProjectStage, WastageReason } from "@/lib/constants";
import type { WastageRow, WastageSummary, WastageTotals } from "./types";

type PopulatedItem = { _id: Types.ObjectId; name: string; sku: string; unit?: string } | null;
type PopulatedProject = { _id: Types.ObjectId; name: string; color?: string } | null;
type PopulatedExpense = { _id: Types.ObjectId; number: string; amount: number } | null;
type PopulatedUser = { _id: Types.ObjectId; name?: string } | null;

const objectIds = (values: string[]) => values.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

/** Mongo filter for wastage movements from list params. */
async function wastageFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = { type: "wastage" };
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    const matching = await InventoryItem.find({ $or: [{ name: re }, { sku: re }] }, { _id: 1 }).limit(500).lean();
    filter.$or = [{ item: { $in: matching.map((i) => i._id) } }, { note: re }, { "wastage.responsible": re }, { "wastage.location": re }];
  }
  if (filters.reason?.length) filter["wastage.reason"] = { $in: filters.reason };
  if (filters.source?.length) filter["wastage.from"] = { $in: filters.source };
  if (filters.department?.length) filter["wastage.department"] = { $in: filters.department };
  if (filters.item?.length) filter.item = { $in: objectIds(filters.item) };
  if (filters.project?.length) filter.project = { $in: objectIds(filters.project) };
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.date = range;
  return filter;
}

function toRow(m: InventoryMovementDoc): WastageRow {
  const item = m.item as unknown as PopulatedItem;
  const project = m.project as unknown as PopulatedProject;
  const expense = m.expense as unknown as PopulatedExpense;
  const by = m.createdBy as unknown as PopulatedUser;
  return {
    id: String(m._id),
    date: iso(m.date)!,
    item: item?._id ? { id: String(item._id), name: item.name, sku: item.sku, unit: item.unit ?? "pcs" } : { id: "", name: "Deleted item", sku: "", unit: "pcs" },
    quantity: m.quantity,
    reason: (m.wastage?.reason ?? "other") as WastageReason,
    from: m.wastage?.from === "project" ? "project" : "storage",
    project: project?._id ? { id: String(project._id), name: project.name, color: project.color ?? "#4a82cc" } : null,
    stage: (m.stage as ProjectStage | undefined) ?? null,
    department: (m.wastage?.department as Department | undefined) ?? null,
    location: m.wastage?.location ?? null,
    responsible: m.wastage?.responsible ?? null,
    value: m.totalCost ?? 0,
    expense: expense?._id ? { id: String(expense._id), number: expense.number, amount: expense.amount } : null,
    note: m.note ?? null,
    by: by?.name ?? null,
  };
}

const empty = (): WastageTotals => ({ units: 0, value: 0, count: 0 });

async function summarize(filter: Record<string, unknown>): Promise<WastageSummary> {
  const rows = await InventoryMovement.aggregate<{ _id: string | null; units: number; value: number; count: number; expensed: number }>([
    { $match: filter },
    { $lookup: { from: "expenses", localField: "expense", foreignField: "_id", as: "booked", pipeline: [{ $project: { amount: 1 } }] } },
    {
      $group: {
        _id: "$wastage.from",
        units: { $sum: "$quantity" },
        value: { $sum: "$totalCost" },
        count: { $sum: 1 },
        expensed: { $sum: { $sum: "$booked.amount" } },
      },
    },
  ]);
  const summary: WastageSummary = { all: empty(), storage: empty(), project: empty(), expensed: 0 };
  for (const r of rows) {
    const key = r._id === "project" ? "project" : "storage";
    const t = summary[key];
    t.units = roundQty(t.units + r.units);
    t.value = round2(t.value + r.value);
    t.count += r.count;
    summary.expensed = round2(summary.expensed + r.expensed);
  }
  summary.all = {
    units: roundQty(summary.storage.units + summary.project.units),
    value: round2(summary.storage.value + summary.project.value),
    count: summary.storage.count + summary.project.count,
  };
  return summary;
}

export async function listWastage(params: ListParams): Promise<Paginated<WastageRow> & { summary: WastageSummary }> {
  await connectDB();
  const filter = await wastageFilter(params);
  const [docs, total, summary] = await Promise.all([
    InventoryMovement.find(filter)
      .sort(mongoSort(params.sort ?? { id: "date", desc: true }))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate("item", "name sku unit")
      .populate("project", "name color")
      .populate("expense", "number amount")
      .populate("createdBy", "name")
      .lean(),
    InventoryMovement.countDocuments(filter),
    summarize(filter),
  ]);
  return { rows: docs.map((d) => toRow(d as unknown as InventoryMovementDoc)), total, page: params.page, pageSize: params.pageSize, summary };
}

/** Wastage value this financial year and all time, at cost (from storage and on projects). */
export async function wastageToDate(): Promise<{ financialYear: WastageTotals; allTime: WastageTotals; fyLabel: string }> {
  await connectDB();
  const fy = financialYearIST();
  const [year, all] = await Promise.all([summarize({ type: "wastage", date: { $gte: fy.start, $lte: fy.end } }), summarize({ type: "wastage" })]);
  return { financialYear: year.all, allTime: all.all, fyLabel: fy.label };
}

/** Places stock is kept, from items and earlier wastage, for the location suggestions. */
export async function getStorageLocations(): Promise<string[]> {
  await connectDB();
  const [fromItems, fromWastage] = await Promise.all([
    InventoryItem.distinct("location", { archivedAt: null }) as Promise<(string | null)[]>,
    InventoryMovement.distinct("wastage.location", { type: "wastage" }) as Promise<(string | null)[]>,
  ]);
  const seen = new Map<string, string>();
  for (const v of [...fromItems, ...fromWastage]) {
    const name = v?.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
