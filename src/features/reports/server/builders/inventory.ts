import "server-only";

import { connectDB } from "@/server/db";
import { allocatedValueByItem } from "@/server/services/metrics";
import { InventoryItem, InventoryMovement } from "@/server/models";
import { movementFilter } from "@/features/inventory/movements/queries";
import { MOVEMENT_TYPES, PROJECT_STAGES, INVENTORY_UNITS, labelOf, type InventoryUnit, type MovementType, type ProjectStage } from "@/lib/constants";
import { STOCK_STATUS_META, getStockStatus } from "@/lib/stock-status";
import { formatDate, round2 } from "@/lib/format";
import { searchRegex } from "@/lib/list-params";
import { col, day, describeFilters, objectIds, projectMatch, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow } from "../../types";
import { roundQty } from "@/server/services/inventory-ledger";

const valuationColumns = [
  col("item", "Item", "text", 30),
  col("sku", "SKU", "text", 16),
  col("category", "Category", "text", 20),
  col("unit", "Unit", "text", 10),
  col("available", "Available", "number", 11),
  col("allocated", "Allocated", "number", 11),
  col("min", "Min stock", "number", 11),
  col("status", "Status", "text", 13),
  col("unitCost", "Unit cost", "money", 14),
  col("value", "On-hand value", "money", 17),
  col("allocatedValue", "Allocated value", "money", 17),
];

async function buildValuation(f: ReportFilters): Promise<ReportData> {
  const query: Record<string, unknown> = { archivedAt: null };
  if (f.category.length) query.category = { $in: objectIds(f.category) };
  if (f.q) query.$or = [{ name: searchRegex(f.q) }, { sku: searchRegex(f.q) }];
  const [items, charged] = await Promise.all([InventoryItem.find(query as never).populate("category", "name").lean(), allocatedValueByItem()]);
  const withCategory = items
    .map((i) => ({ i, category: (i.category as unknown as { name: string } | null)?.name ?? "Uncategorized" }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.i.name.localeCompare(b.i.name));

  const rows: ReportRow[] = [];
  let group: { name: string; value: number; allocated: number; count: number } | null = null;
  const flush = () => {
    if (!group) return;
    rows.push({
      item: `Subtotal: ${group.name} (${group.count} ${group.count === 1 ? "item" : "items"})`,
      category: group.name,
      value: round2(group.value),
      allocatedValue: round2(group.allocated),
      _kind: "subtotal",
    });
  };
  let onHandValue = 0;
  let allocatedValue = 0;
  const status = { in_stock: 0, low_stock: 0, out_of_stock: 0 };
  for (const { i, category } of withCategory) {
    if (!group || group.name !== category) {
      flush();
      group = { name: category, value: 0, allocated: 0, count: 0 };
    }
    const value = round2(i.available * i.unitPrice);
    const alloc = charged.get(String(i._id)) ?? 0;
    group.value += value;
    group.allocated += alloc;
    group.count += 1;
    onHandValue += value;
    allocatedValue += alloc;
    const st = getStockStatus(roundQty(i.available), i.minStock);
    status[st] += 1;
    rows.push({
      item: i.name,
      sku: i.sku,
      category,
      unit: labelOf(INVENTORY_UNITS, (i.unit ?? "pcs") as InventoryUnit),
      available: i.available,
      allocated: i.allocated,
      min: i.minStock,
      status: STOCK_STATUS_META[st].label,
      unitCost: i.unitPrice,
      value,
      allocatedValue: alloc,
    });
  }
  flush();

  return {
    type: "inventory",
    title: "Inventory valuation report",
    subtitle: [`Stock position as of ${formatDate(new Date())}`, await describeFilters(f, { period: false, categories: "inventory", vendor: false, project: false })]
      .filter(Boolean)
      .join(" · "),
    columns: valuationColumns,
    rows,
    // Unit costs added up mean nothing: only the values are totalled.
    totals: sumTotals(valuationColumns, rows, "Total", ["money"], ["value", "allocatedValue"]),
    summary: [
      { label: "Items", value: withCategory.length, type: "number" },
      { label: "On-hand value", value: round2(onHandValue), type: "money" },
      { label: "Allocated value", value: round2(allocatedValue), type: "money" },
      { label: "In stock", value: status.in_stock, type: "number" },
      { label: "Low stock", value: status.low_stock, type: "number" },
      { label: "Out of stock", value: status.out_of_stock, type: "number" },
    ],
  };
}

const movementColumns = [
  col("date", "Date", "date", 13),
  col("item", "Item", "text", 28),
  col("sku", "SKU", "text", 16),
  col("type", "Type", "text", 20),
  col("quantity", "Quantity", "number", 11),
  col("unitCost", "Unit cost", "money", 14),
  col("totalCost", "Total cost", "money", 16),
  col("project", "Project", "text", 22),
  col("stage", "Stage", "text", 13),
  col("vendor", "Vendor", "text", 22),
  col("invoice", "Invoice no", "text", 16),
  col("balance", "Available after", "number", 14),
  col("note", "Note", "text", 28),
];

async function buildMovements(f: ReportFilters): Promise<ReportData> {
  // The Movements page's own filter, so an export from that page holds exactly the rows it lists.
  const query = (await movementFilter({
    q: f.q,
    from: f.from,
    to: f.to,
    filters: {
      ...(f.movementType.length ? { type: f.movementType } : {}),
      ...(f.item.length ? { item: f.item } : {}),
    },
  })) as Record<string, unknown>;
  // Report-only filters on top: "No project", vendor and inventory category.
  const project = projectMatch(f.project);
  if (project) query.project = project;
  if (f.vendor.length) query.vendor = { $in: f.vendor };
  if (f.category.length) {
    const ids = await InventoryItem.find({ category: { $in: objectIds(f.category) } }, { _id: 1 }).lean();
    // Both an item and a category filter may be set: a movement must match both.
    query.$and = [...((query.$and as unknown[]) ?? []), { item: { $in: ids.map((d) => d._id) } }];
  }

  const docs = await InventoryMovement.find(query as never)
    .sort({ date: 1, _id: 1 })
    .populate("item", "name sku")
    .populate("project", "name")
    .lean();

  const rows: ReportRow[] = docs.map((m) => {
    const item = m.item as unknown as { name: string; sku: string } | null;
    return {
      date: day(m.date),
      item: item?.name ?? "Deleted item",
      sku: item?.sku ?? "",
      type: labelOf(MOVEMENT_TYPES, m.type as MovementType),
      quantity: m.availableDelta !== 0 ? m.availableDelta : m.allocatedDelta,
      unitCost: m.unitCost ?? 0,
      totalCost: m.totalCost ?? 0,
      project: (m.project as unknown as { name: string } | null)?.name ?? "",
      stage: m.stage ? labelOf(PROJECT_STAGES, m.stage as ProjectStage) : "",
      vendor: m.vendor ?? "",
      invoice: m.invoice?.number ?? "",
      balance: m.balance?.available ?? 0,
      note: m.note ?? "",
    };
  });
  // No totals row: unit costs do not add up, and stock in and stock out would cancel into a meaningless cost.
  const totals = null;
  const count = (t: MovementType) => docs.filter((m) => m.type === t).length;
  const purchased = docs.filter((m) => m.type === "purchase").reduce((s, m) => s + (m.totalCost ?? 0), 0);

  return {
    type: "inventory",
    title: "Stock movement report",
    subtitle: await describeFilters(f, { categories: "inventory", passthrough: ["movementType", "item"] }),
    columns: movementColumns,
    rows,
    totals,
    summary: [
      { label: "Movements", value: rows.length, type: "number" },
      { label: "Purchases", value: count("purchase"), type: "number" },
      { label: "Assignments", value: count("assign"), type: "number" },
      { label: "Returns", value: count("return"), type: "number" },
      { label: "Adjustments", value: count("adjustment"), type: "number" },
      { label: "Purchased value", value: round2(purchased), type: "money" },
    ],
  };
}

export async function buildInventoryReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  return f.movements ? buildMovements(f) : buildValuation(f);
}
