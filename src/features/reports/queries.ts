import "server-only";

import { connectDB } from "@/server/db";
import { canSeeSalaries, getCurrentUser } from "@/server/auth/session";
import { InventoryItem, InventoryMovement, Report } from "@/server/models";
import { dateRangeFilter } from "@/lib/dates";
import { MOVEMENT_TYPES, labelOf, type MovementType } from "@/lib/constants";
import { round2 } from "@/lib/format";
import { iso } from "@/server/serialize";
import { getStockStatus } from "@/lib/stock-status";
import { allocatedValueByItem } from "@/server/services/metrics";
import { reportHref } from "./schemas";
import { buildReport, rowCountOf, sectionsOf } from "./server/build";
import type { ReportFilters, ReportHistoryRow, ReportPreview } from "./types";
import type { ReportType } from "@/lib/constants";
import { roundQty } from "@/server/services/inventory-ledger";

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

/** Every filter "Download again" reapplies, in words. Older log rows may lack some keys. */
function summarise(filters: Partial<ReportFilters> & { movements?: boolean }): string {
  const parts: string[] = [];
  if (filters.from || filters.to) parts.push(`${filters.from ?? "start"} to ${filters.to ?? "today"}`);
  const count = (n: number | undefined, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : null);
  for (const p of [
    count(filters.project?.length, "project"),
    count(filters.vendor?.length, "vendor"),
    count(filters.category?.length, "category", "categories"),
    count(filters.stage?.length, "stage"),
    count(filters.paymentMethod?.length, "payment method"),
    count(filters.source?.length, "source"),
    count(filters.movementType?.length, "movement type"),
    count(filters.item?.length, "item"),
  ]) {
    if (p) parts.push(p);
  }
  if (filters.q) parts.push(`Search "${filters.q}"`);
  if (filters.movements) parts.push("movement ledger");
  return parts.join(" · ") || "All data";
}

/**
 * The latest exports, newest first, each with a link that regenerates it with the same filters.
 * Members see only their own: an admin's row can carry salary payees in its filters and a row count
 * that includes salary entries.
 */
export async function listReportHistory(limit = 20): Promise<ReportHistoryRow[]> {
  await connectDB();
  const [user, seesAll] = await Promise.all([getCurrentUser(), canSeeSalaries()]);
  if (!user) return [];
  const docs = await Report.find(seesAll ? {} : { generatedBy: user.id }).sort({ createdAt: -1 }).limit(limit).populate("generatedBy", "name").lean();
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

/** Valuation by category, stock status mix and movement totals for the range. */
export async function getInventoryReportOverview(range: { from: string | null; to: string | null }): Promise<InventoryReportOverview> {
  await connectDB();
  const dateMatch = dateRangeFilter(range.from, range.to);
  const [items, charged, movements] = await Promise.all([
    InventoryItem.find({ archivedAt: null }, { category: 1, available: 1, unitPrice: 1, minStock: 1 }).populate("category", "name").lean(),
    allocatedValueByItem(),
    InventoryMovement.aggregate<{ _id: MovementType; count: number; units: number; value: number }>([
      { $match: dateMatch ? { date: dateMatch } : {} },
      { $group: { _id: "$type", count: { $sum: 1 }, units: { $sum: "$quantity" }, value: { $sum: "$totalCost" } } },
    ]),
  ]);

  // Same arithmetic as the valuation report (each item rounded, then added), so the two totals agree to the paisa.
  const status = { in_stock: 0, low_stock: 0, out_of_stock: 0 };
  const byCategory = new Map<string, CategoryValue>();
  for (const i of items) {
    const cat = i.category as unknown as { _id: unknown; name: string } | null;
    const id = cat?._id ? String(cat._id) : "none";
    const c = byCategory.get(id) ?? { id, name: cat?.name ?? "Uncategorized", items: 0, value: 0, allocatedValue: 0 };
    c.items += 1;
    c.value = round2(c.value + round2(i.available * i.unitPrice));
    c.allocatedValue = round2(c.allocatedValue + (charged.get(String(i._id)) ?? 0));
    byCategory.set(id, c);
    status[getStockStatus(roundQty(i.available), i.minStock)] += 1;
  }
  const categories = [...byCategory.values()].sort((a, b) => b.value - a.value);
  const byType = new Map(movements.map((m) => [m._id, m]));
  return {
    items: items.length,
    value: round2(categories.reduce((s, c) => s + c.value, 0)),
    allocatedValue: round2(categories.reduce((s, c) => s + c.allocatedValue, 0)),
    status,
    categories,
    movements: MOVEMENT_TYPES.map((t) => {
      const m = byType.get(t.value);
      return { type: t.value, label: labelOf(MOVEMENT_TYPES, t.value), count: m?.count ?? 0, units: m?.units ?? 0, value: round2(m?.value ?? 0) };
    }),
  };
}
