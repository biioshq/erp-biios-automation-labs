import "server-only";

import { connectDB } from "@/server/db";
import { InventoryItem, InventoryMovement, Report } from "@/server/models";
import { dateRangeFilter } from "@/lib/dates";
import { MOVEMENT_TYPES, labelOf, type MovementType } from "@/lib/constants";
import { round2 } from "@/lib/format";
import { iso } from "@/server/serialize";
import { reportHref } from "./schemas";
import { buildReport, rowCountOf, sectionsOf } from "./server/build";
import type { ReportFilters, ReportHistoryRow, ReportPreview } from "./types";
import type { ReportType } from "@/lib/constants";

export const PREVIEW_ROWS = 50;

export async function getReportPreview(type: ReportType, filters: ReportFilters): Promise<ReportPreview> {
  const report = await buildReport(type, filters);
  return {
    type,
    title: report.title,
    subtitle: report.subtitle,
    summary: report.summary,
    rowCount: rowCountOf(report),
    sections: sectionsOf(report).map((s) => ({
      title: s.title,
      columns: s.columns,
      rows: s.rows.slice(0, PREVIEW_ROWS),
      totals: s.totals,
      totalRows: s.rows.length,
    })),
  };
}

function summarise(filters: Partial<ReportFilters> & { movements?: boolean }): string {
  const parts: string[] = [];
  if (filters.from || filters.to) parts.push(`${filters.from ?? "start"} to ${filters.to ?? "today"}`);
  const count = (n: number | undefined, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : null);
  for (const p of [count(filters.project?.length, "project"), count(filters.vendor?.length, "vendor"), count(filters.category?.length, "category")]) {
    if (p) parts.push(p);
  }
  if (filters.movements) parts.push("movement ledger");
  return parts.join(" · ") || "All data";
}

/** The latest exports, newest first, each with a link that regenerates it with the same filters. */
export async function listReportHistory(limit = 20): Promise<ReportHistoryRow[]> {
  await connectDB();
  const docs = await Report.find().sort({ createdAt: -1 }).limit(limit).populate("generatedBy", "name").lean();
  return docs.map((d) => {
    const filters = (d.filters ?? {}) as Partial<ReportFilters>;
    const by = d.generatedBy as unknown as { name?: string } | null;
    return {
      id: String(d._id),
      type: d.type as ReportType,
      format: d.format,
      title: d.title,
      filtersSummary: summarise(filters),
      rowCount: d.rowCount ?? 0,
      by: by?.name ?? null,
      createdAt: iso(d.createdAt as Date)!,
      href: reportHref(d.type as ReportType, d.format, filters),
    };
  });
}

export type CategoryValue = { id: string; name: string; items: number; value: number; allocatedValue: number };
export type MovementTypeSummary = { type: MovementType; label: string; count: number; units: number; value: number };

export type InventoryReportOverview = {
  items: number;
  value: number;
  allocatedValue: number;
  status: { in_stock: number; low_stock: number; out_of_stock: number };
  categories: CategoryValue[];
  movements: MovementTypeSummary[];
};

/** Valuation by category, stock status mix and movement totals for the range, all by aggregation. */
export async function getInventoryReportOverview(range: { from: string | null; to: string | null }): Promise<InventoryReportOverview> {
  await connectDB();
  const dateMatch = dateRangeFilter(range.from, range.to);
  const [cats, movements] = await Promise.all([
    InventoryItem.aggregate<{
      _id: unknown;
      name: string | null;
      items: number;
      value: number;
      allocatedValue: number;
      inStock: number;
      lowStock: number;
      outOfStock: number;
    }>([
      { $match: { archivedAt: null } },
      { $lookup: { from: "inventoryCategories", localField: "category", foreignField: "_id", as: "cat" } },
      {
        $group: {
          _id: "$category",
          name: { $first: { $arrayElemAt: ["$cat.name", 0] } },
          items: { $sum: 1 },
          value: { $sum: { $multiply: ["$available", "$unitPrice"] } },
          allocatedValue: { $sum: { $multiply: ["$allocated", "$unitPrice"] } },
          outOfStock: { $sum: { $cond: [{ $lte: ["$available", 0] }, 1, 0] } },
          lowStock: { $sum: { $cond: [{ $and: [{ $gt: ["$available", 0] }, { $lte: ["$available", "$minStock"] }] }, 1, 0] } },
          inStock: { $sum: { $cond: [{ $and: [{ $gt: ["$available", 0] }, { $gt: ["$available", "$minStock"] }] }, 1, 0] } },
        },
      },
      { $sort: { value: -1 } },
    ]),
    InventoryMovement.aggregate<{ _id: MovementType; count: number; units: number; value: number }>([
      { $match: dateMatch ? { date: dateMatch } : {} },
      { $group: { _id: "$type", count: { $sum: 1 }, units: { $sum: "$quantity" }, value: { $sum: "$totalCost" } } },
    ]),
  ]);

  const status = { in_stock: 0, low_stock: 0, out_of_stock: 0 };
  for (const c of cats) {
    status.in_stock += c.inStock;
    status.low_stock += c.lowStock;
    status.out_of_stock += c.outOfStock;
  }
  const byType = new Map(movements.map((m) => [m._id, m]));
  return {
    items: cats.reduce((s, c) => s + c.items, 0),
    value: round2(cats.reduce((s, c) => s + c.value, 0)),
    allocatedValue: round2(cats.reduce((s, c) => s + c.allocatedValue, 0)),
    status,
    categories: cats.map((c) => ({
      id: c._id ? String(c._id) : "none",
      name: c.name ?? "Uncategorised",
      items: c.items,
      value: round2(c.value),
      allocatedValue: round2(c.allocatedValue),
    })),
    movements: MOVEMENT_TYPES.map((t) => {
      const m = byType.get(t.value);
      return { type: t.value, label: labelOf(MOVEMENT_TYPES, t.value), count: m?.count ?? 0, units: m?.units ?? 0, value: round2(m?.value ?? 0) };
    }),
  };
}
