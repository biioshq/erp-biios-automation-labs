import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Income, InventoryAllocation, InventoryItem, Project } from "@/server/models";
import { PROJECT_STAGES, type ProjectStage } from "@/lib/constants";
import { monthKeyIST, startOfMonthIST } from "@/lib/dates";
import { roundQty } from "@/server/services/inventory-ledger";
import { round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";

/**
 * The ERP's shared numbers. Dashboards, project pages and reports all read
 * these, so a figure is computed one way everywhere.
 *
 *  - Spend is always the sum of expenses (manual, recurring, stock purchases and
 *    inventory assignments). Per-project spend leaves salaries out for members
 *    (see projectSpend).
 *  - Company totals leave out assignment records marked countedAtPurchase: that
 *    stock was expensed when it was bought, so counting its use again would count
 *    it twice. Project spend includes them: they are the project's cost.
 *  - Inventory value is stock on hand: available × weighted average cost.
 *    Allocated stock is already counted as project expenses, so it is not
 *    counted again here. Its value is what was charged to the projects.
 */

type Range = { from?: Date; to?: Date };

/**
 * Expenses that count in company totals: everything except the project cost of stock already
 * expensed at purchase. `$ne: true` also matches records without the field (all older ones),
 * and needs no index.
 */
export const COMPANY_EXPENSES = { countedAtPurchase: { $ne: true } } as const;

const dateMatch = (field: string, range?: Range) =>
  range?.from || range?.to
    ? { [field]: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } }
    : {};

/** Total income, total expenses and profit for a period (all time when no range). */
export async function financeTotals(range?: Range) {
  await connectDB();
  const [inc, exp] = await Promise.all([
    Income.aggregate<{ total: number; count: number }>([
      { $match: dateMatch("date", range) },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate<{ total: number; count: number; tax: number }>([
      { $match: { ...dateMatch("date", range), ...COMPANY_EXPENSES } },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
          tax: { $sum: { $add: [{ $ifNull: ["$gst.cgst", 0] }, { $ifNull: ["$gst.sgst", 0] }, { $ifNull: ["$gst.igst", 0] }, { $ifNull: ["$gst.cess", 0] }] } },
        },
      },
    ]),
  ]);
  const income = round2(inc[0]?.total ?? 0);
  const expenses = round2(exp[0]?.total ?? 0);
  return {
    income,
    expenses,
    profit: round2(income - expenses),
    incomeCount: inc[0]?.count ?? 0,
    expenseCount: exp[0]?.count ?? 0,
    gstPaid: round2(exp[0]?.tax ?? 0),
  };
}

/** Income and expenses per month for the last `months` months (IST), oldest first, zero-filled. */
export async function monthlyIncomeExpense(months = 12) {
  await connectDB();
  const from = startOfMonthIST(new Date(), -(months - 1));
  const group = (amountField: string, extra: Record<string, unknown> = {}) => [
    { $match: { date: { $gte: from }, ...extra } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } },
        total: { $sum: amountField },
      },
    },
  ];
  const [inc, exp] = await Promise.all([
    Income.aggregate<{ _id: string; total: number }>(group("$amount")),
    Expense.aggregate<{ _id: string; total: number }>(group("$amount", COMPANY_EXPENSES)),
  ]);
  const incomeBy = new Map(inc.map((r) => [r._id, r.total]));
  const expenseBy = new Map(exp.map((r) => [r._id, r.total]));
  return Array.from({ length: months }, (_, i) => {
    const key = monthKeyIST(startOfMonthIST(new Date(), -(months - 1) + i));
    const income = round2(incomeBy.get(key) ?? 0);
    const expenses = round2(expenseBy.get(key) ?? 0);
    return { month: key, income, expenses, profit: round2(income - expenses) };
  });
}

/** Expenses per month split by category for the last `months` months. */
export async function monthlyExpensesByCategory(months = 6) {
  await connectDB();
  const from = startOfMonthIST(new Date(), -(months - 1));
  const rows = await Expense.aggregate<{ _id: { month: string; category: string }; total: number }>([
    { $match: { date: { $gte: from }, ...COMPANY_EXPENSES } },
    {
      $group: {
        _id: { month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } }, category: "$category" },
        total: { $sum: "$amount" },
      },
    },
  ]);
  return rows.map((r) => ({ month: r._id.month, category: r._id.category, total: round2(r.total) }));
}

export type ProjectSpend = {
  projectId: string;
  spent: number;
  byStage: Record<ProjectStage, number>;
  expenseCount: number;
  income: number;
  /** True when salary expenses are left out of spent, byStage and expenseCount (member view). */
  salariesHidden: boolean;
};

const emptyStages = () => Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, 0])) as Record<ProjectStage, number>;

export type SpendOptions = {
  /**
   * Whether salary expenses count. Defaults to the viewer: admins see them,
   * members do not, because a project or stage whose spend includes one
   * salary would let a member work out that person's pay.
   */
  includeSalaries?: boolean;
};

/** The viewer's default. Imported lazily so scripts that pass includeSalaries can load this module without a request. */
async function viewerSeesSalaries(options: SpendOptions) {
  if (options.includeSalaries !== undefined) return options.includeSalaries;
  const { canSeeSalaries } = await import("@/server/auth/session");
  return canSeeSalaries();
}

/**
 * Spend (total and per stage) and income received, per project. Pass ids to limit the scope.
 * Includes stock counted at purchase: it is part of what the project used.
 */
export async function projectSpend(
  projectIds?: (string | Types.ObjectId)[],
  options: SpendOptions = {},
): Promise<Map<string, ProjectSpend>> {
  await connectDB();
  const includeSalaries = await viewerSeesSalaries(options);
  const salariesHidden = !includeSalaries;
  const ids = projectIds?.map((id) => new Types.ObjectId(String(id)));
  const match = ids ? { project: { $in: ids } } : { project: { $ne: null } };
  const [stages, incomes] = await Promise.all([
    Expense.aggregate<{ _id: { project: Types.ObjectId; stage: ProjectStage | null }; total: number; count: number }>([
      { $match: salariesHidden ? { ...match, category: { $ne: "salaries" } } : match },
      { $group: { _id: { project: "$project", stage: "$stage" }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Income.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: match },
      { $group: { _id: "$project", total: { $sum: "$amount" } } },
    ]),
  ]);
  const out = new Map<string, ProjectSpend>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { projectId: id, spent: 0, byStage: emptyStages(), expenseCount: 0, income: 0, salariesHidden });
    return out.get(id)!;
  };
  for (const row of stages) {
    const entry = get(String(row._id.project));
    entry.spent = round2(entry.spent + row.total);
    entry.expenseCount += row.count;
    if (row._id.stage) entry.byStage[row._id.stage] = round2(entry.byStage[row._id.stage] + row.total);
  }
  for (const row of incomes) get(String(row._id)).income = round2(row.total);
  ids?.forEach((id) => get(String(id)));
  return out;
}

/** Budget usage for every project (or the given ones): budget, spent, remaining, ratio. */
export async function budgetUsage(filter: { status?: string[] } = {}, options: SpendOptions = {}) {
  await connectDB();
  const includeSalaries = await viewerSeesSalaries(options);
  const query: Record<string, unknown> = filter.status ? { status: { $in: filter.status } } : {};
  const projects = await Project.find(query, {
    name: 1,
    code: 1,
    budget: 1,
    status: 1,
    color: 1,
  })
    .sort({ budget: -1 })
    .lean();
  const spend = await projectSpend(
    projects.map((p) => p._id),
    { includeSalaries },
  );
  return projects.map((p) => {
    const spent = spend.get(String(p._id))?.spent ?? 0;
    return {
      id: String(p._id),
      name: p.name,
      code: p.code,
      status: p.status,
      color: p.color ?? "#4a82cc",
      budget: p.budget,
      spent,
      remaining: round2(p.budget - spent),
      usage: p.budget > 0 ? spent / p.budget : 0,
      salariesHidden: !includeSalaries,
    };
  });
}

/**
 * Value of stock that projects hold, per item id: what was charged to the
 * projects (each open assignment's remaining quantity × the cost it was
 * assigned at, rounded per expense like the expense itself), net of returns.
 * Not allocated × today's average: later purchases change the average but not
 * what the projects were charged. Archived items are left out, as everywhere.
 */
export async function allocatedValueByItem(): Promise<Map<string, number>> {
  await connectDB();
  const [allocations, archived] = await Promise.all([
    InventoryAllocation.find({ quantity: { $gt: 0 } }, { item: 1, quantity: 1, unitCost: 1 }).lean(),
    InventoryItem.find({ archivedAt: { $ne: null } }, { _id: 1 }).lean(),
  ]);
  const skip = new Set(archived.map((i) => String(i._id)));
  const out = new Map<string, number>();
  for (const a of allocations) {
    const id = String(a.item);
    if (skip.has(id)) continue;
    out.set(id, round2((out.get(id) ?? 0) + round2(a.quantity * a.unitCost)));
  }
  return out;
}

/** Value of stock on hand and counts by stock status. */
export async function inventorySnapshot() {
  await connectDB();
  const [items, allocated] = await Promise.all([
    InventoryItem.find({ archivedAt: null }, { available: 1, unitPrice: 1, minStock: 1 }).lean(),
    allocatedValueByItem(),
  ]);
  // Each item's value is rounded to paise before adding, as the inventory reports do, so the
  // dashboard and the valuation report agree to the paisa (Mongo's $round rounds half to even).
  let value = 0;
  let allocatedValue = 0;
  const counts = { inStock: 0, lowStock: 0, outOfStock: 0 };
  for (const i of items) {
    value = round2(value + round2(i.available * i.unitPrice));
    allocatedValue = round2(allocatedValue + (allocated.get(String(i._id)) ?? 0));
    // On the 3-decimal quantity, as the items list and the ledger forms, so drift that older
    // writes stored (5.55e-17) counts as Out of Stock here too.
    const status = getStockStatus(roundQty(i.available), i.minStock ?? 0);
    if (status === "in_stock") counts.inStock += 1;
    else if (status === "low_stock") counts.lowStock += 1;
    else counts.outOfStock += 1;
  }
  return { items: items.length, value, allocatedValue, ...counts };
}
