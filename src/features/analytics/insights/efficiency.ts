import "server-only";

import { connectDB } from "@/server/db";
import { Expense, InventoryMovement } from "@/server/models";
import { usageByItem } from "@/server/analytics/core";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { getExpenseCategoryLabeler, getExpenseCategoryNatures } from "@/server/expense-categories";
import { WASTAGE_REASONS, labelOf, type WastageReason } from "@/lib/constants";
import { endOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import { equipmentUse, maintenanceDue, manpower, monthKeys, monthlyStock, projectHealth, stockOutlook } from "../dashboard/measures";
import { TREND_MONTHS, daysBetween } from "../dashboard/rules";
import { itemInfo, loadPurchaseEntries } from "./purchases";
import type { EfficiencyInsights } from "./types";

const ITEM_ROWS = 25;
const GENERATED_STOCK_SOURCES = ["inventory_purchase", "inventory_assignment", "inventory_wastage"];
/** Loan interest and bank charges are finance costs in the P&L, not running costs. */
const FINANCE_COST_SOURCES = ["liability_interest"];
const FINANCE_COST_CATEGORIES = ["interest"];

/** Stock received (every purchase entry) against stock used and wasted, per item, over the window. */
async function itemUtilisation(from: Date, now: Date, available: Map<string, number>) {
  const days = daysBetween(toDateInput(from), toDateInput(now)) + 1;
  // Up to the end of today, as the monthly figures beside it.
  const [usage, entries] = await Promise.all([usageByItem(days, endOfDayIST(now)), loadPurchaseEntries({ date: { $gte: from, $lte: endOfDayIST(now) } }, false)]);
  const received = new Map<string, number>();
  for (const e of entries) received.set(String(e.item), (received.get(String(e.item)) ?? 0) + e.quantity);
  const ids = [...new Set([...received.keys(), ...[...usage.values()].filter((u) => u.consumed > 0 || u.wasted > 0).map((u) => u.itemId)])];
  const info = await itemInfo(ids);
  return ids
    .flatMap((id) => {
      const i = info.get(id);
      if (!i || i.archived) return [];
      const u = usage.get(id);
      const got = Math.round((received.get(id) ?? 0) * 1000) / 1000;
      const consumed = u?.consumed ?? 0;
      return [{ id, name: i.name, unit: i.unit, received: got, consumed, wasted: u?.wasted ?? 0, available: available.get(id) ?? 0, ratio: got > 0 ? consumed / got : null }];
    })
    .sort((a, b) => b.consumed - a.consumed || b.received - a.received || a.name.localeCompare(b.name));
}

/** Wastage entries over the window, by reason and by where the stock was. */
async function wastage(from: Date, now: Date) {
  await connectDB();
  const rows = await InventoryMovement.aggregate<{ _id: { reason: string | null; from: string | null }; value: number; n: number }>([
    { $match: { type: "wastage", date: { $gte: from, $lte: endOfDayIST(now) } } },
    { $group: { _id: { reason: "$wastage.reason", from: "$wastage.from" }, value: { $sum: "$totalCost" }, n: { $sum: 1 } } },
  ]);
  const byReason = new Map<string, { reason: string; label: string; value: number; entries: number }>();
  let storage = 0;
  let project = 0;
  for (const r of rows) {
    const reason = r._id.reason ?? "other";
    const b = byReason.get(reason) ?? { reason, label: r._id.reason ? labelOf(WASTAGE_REASONS, reason as WastageReason) : "Reason not recorded", value: 0, entries: 0 };
    b.value = round2(b.value + r.value);
    b.entries += r.n;
    byReason.set(reason, b);
    if (r._id.from === "project") project += r.value;
    else storage += r.value;
  }
  return { total: round2(storage + project), storage: round2(storage), project: round2(project), byReason: [...byReason.values()].sort((a, b) => b.value - a.value) };
}

/**
 * Overheads by month: company expenses not booked to a project whose category is indirect (the
 * admin's setting, else the built-in default). Fixed-asset purchases, generated stock records and
 * finance costs (loan interest, bank charges: the P&L's finance section) are not running costs.
 * Members get the figures without salaries.
 */
async function overheads(from: Date, now: Date, includeSalaries: boolean) {
  await connectDB();
  const [rows, natureOf, labelOfCategory] = await Promise.all([
    Expense.aggregate<{ _id: { month: string; category: string }; total: number }>([
      {
        $match: {
          ...COMPANY_EXPENSES,
          date: { $gte: from, $lte: endOfDayIST(now) },
          project: null,
          capitalAsset: null,
          source: { $nin: [...GENERATED_STOCK_SOURCES, ...FINANCE_COST_SOURCES] },
          category: { $nin: includeSalaries ? FINANCE_COST_CATEGORIES : [...FINANCE_COST_CATEGORIES, "salaries"] },
        },
      },
      { $group: { _id: { month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } }, category: "$category" }, total: { $sum: "$amount" } } },
    ]),
    getExpenseCategoryNatures(),
    getExpenseCategoryLabeler(),
  ]);
  const months = new Map(monthKeys(TREND_MONTHS, now).map((m) => [m, 0]));
  const categories = new Map<string, number>();
  for (const r of rows) {
    if (natureOf(r._id.category) !== "indirect" || !months.has(r._id.month)) continue;
    months.set(r._id.month, round2(months.get(r._id.month)! + r.total));
    categories.set(r._id.category, round2((categories.get(r._id.category) ?? 0) + r.total));
  }
  return {
    months: [...months.entries()].map(([month, amount]) => ({ month, amount })),
    categories: [...categories.entries()].map(([value, amount]) => ({ value, label: labelOfCategory(value), amount })).sort((a, b) => b.amount - a.amount),
    total: round2([...categories.values()].reduce((s, v) => s + v, 0)),
  };
}

/** 6.5 Operational efficiency: how materials, equipment and people are used, delays, shortages, wastage and overheads. */
export async function getEfficiencyInsights(viewer: { isAdmin: boolean }, now: Date = new Date()): Promise<EfficiencyInsights> {
  const from = startOfMonthIST(now, -(TREND_MONTHS - 1));
  const [months, stock, projects, people, equipment, maintenance, waste, overhead] = await Promise.all([
    monthlyStock(TREND_MONTHS, now),
    stockOutlook(now),
    projectHealth(viewer.isAdmin, now),
    manpower(now),
    equipmentUse(now),
    maintenanceDue(now),
    wastage(from, now),
    overheads(from, now, viewer.isAdmin),
  ]);
  const items = await itemUtilisation(from, now, new Map(stock.positions.map((p) => [p.id, p.available])));

  const consumed = round2(months.reduce((s, m) => s + m.consumed, 0));
  const bought = round2(months.reduce((s, m) => s + m.bought, 0));
  const opening = round2(months.reduce((s, m) => s + m.opening, 0));
  const active = projects.filter((p) => p.status === "active");
  const allocations = people.employees.map((e) => e.allocation);

  return {
    windowLabel: `since ${formatDate(from)}`,
    months,
    materials: {
      consumed,
      bought,
      opening,
      wasted: round2(months.reduce((s, m) => s + m.wasted, 0)),
      // Used against everything that came into stock in the window, bought or entered.
      ratio: bought + opening > 0 ? consumed / (bought + opening) : null,
    },
    items: items.slice(0, ITEM_ROWS),
    equipment: { total: equipment.length, onProjects: equipment.filter((e) => e.project).length, rows: equipment },
    people: {
      active: people.employees.length,
      average: allocations.length ? allocations.reduce((s, a) => s + a, 0) / allocations.length / 100 : null,
      over: people.overAllocated,
      unallocated: allocations.filter((a) => a === 0).length,
      full: allocations.filter((a) => a >= 100).length,
      employees: [...people.employees].sort((a, b) => b.allocation - a.allocation || a.name.localeCompare(b.name)),
      unstaffed: people.unstaffed,
    },
    delays: {
      projects: active.filter((p) => p.atRisk),
      overdueTasks: active.reduce((s, p) => s + p.tasks.overdue, 0),
      pastEnd: active.filter((p) => p.pastEnd).length,
    },
    shortages: {
      out: stock.alerts.filter((a) => a.level === "out").length,
      belowMin: stock.alerts.filter((a) => a.level === "below_min").length,
      runsOut: stock.alerts.filter((a) => a.level === "runs_out").length,
    },
    maintenance,
    wastage: waste,
    overheads: overhead,
    salariesHidden: !viewer.isAdmin,
  };
}
