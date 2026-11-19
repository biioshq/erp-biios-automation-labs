import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Income, InventoryItem, Project } from "@/server/models";
import { PROJECT_STAGES, type ProjectStage } from "@/lib/constants";
import { monthKeyIST, startOfMonthIST } from "@/lib/dates";
import { round2 } from "@/lib/format";

/**
 * The ERP's shared numbers. Dashboards, project pages and reports all read
 * these, so a figure is computed one way everywhere.
 *
 *  - Spend is always the sum of expenses (manual + inventory assignments).
 *  - Inventory value is stock on hand: available × weighted average cost.
 *    Allocated stock is already counted as project expenses, so it is not
 *    counted again here.
 */

type Range = { from?: Date; to?: Date };

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
      { $match: dateMatch("date", range) },
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
  const group = (amountField: string) => [
    { $match: { date: { $gte: from } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } },
        total: { $sum: amountField },
      },
    },
  ];
  const [inc, exp] = await Promise.all([
    Income.aggregate<{ _id: string; total: number }>(group("$amount")),
    Expense.aggregate<{ _id: string; total: number }>(group("$amount")),
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
    { $match: { date: { $gte: from } } },
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
};

const emptyStages = () => Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, 0])) as Record<ProjectStage, number>;

/** Spend (total and per stage) and income received, per project. Pass ids to limit the scope. */
export async function projectSpend(projectIds?: (string | Types.ObjectId)[]): Promise<Map<string, ProjectSpend>> {
  await connectDB();
  const ids = projectIds?.map((id) => new Types.ObjectId(String(id)));
  const match = ids ? { project: { $in: ids } } : { project: { $ne: null } };
  const [stages, incomes] = await Promise.all([
    Expense.aggregate<{ _id: { project: Types.ObjectId; stage: ProjectStage | null }; total: number; count: number }>([
      { $match: match },
      { $group: { _id: { project: "$project", stage: "$stage" }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Income.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: match },
      { $group: { _id: "$project", total: { $sum: "$amount" } } },
    ]),
  ]);
  const out = new Map<string, ProjectSpend>();
  const get = (id: string) => {
    if (!out.has(id)) out.set(id, { projectId: id, spent: 0, byStage: emptyStages(), expenseCount: 0, income: 0 });
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
export async function budgetUsage(filter: { status?: string[] } = {}) {
  await connectDB();
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
  const spend = await projectSpend(projects.map((p) => p._id));
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
    };
  });
}

/** Value of stock on hand and counts by stock status. */
export async function inventorySnapshot() {
  await connectDB();
  const [row] = await InventoryItem.aggregate<{
    items: number;
    value: number;
    allocatedValue: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
  }>([
    { $match: { archivedAt: null } },
    {
      $group: {
        _id: null,
        items: { $sum: 1 },
        value: { $sum: { $multiply: ["$available", "$unitPrice"] } },
        allocatedValue: { $sum: { $multiply: ["$allocated", "$unitPrice"] } },
        outOfStock: { $sum: { $cond: [{ $lte: ["$available", 0] }, 1, 0] } },
        lowStock: { $sum: { $cond: [{ $and: [{ $gt: ["$available", 0] }, { $lte: ["$available", "$minStock"] }] }, 1, 0] } },
        inStock: { $sum: { $cond: [{ $and: [{ $gt: ["$available", 0] }, { $gt: ["$available", "$minStock"] }] }, 1, 0] } },
      },
    },
  ]);
  return {
    items: row?.items ?? 0,
    value: round2(row?.value ?? 0),
    allocatedValue: round2(row?.allocatedValue ?? 0),
    inStock: row?.inStock ?? 0,
    lowStock: row?.lowStock ?? 0,
    outOfStock: row?.outOfStock ?? 0,
  };
}
