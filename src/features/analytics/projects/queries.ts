import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Project } from "@/server/models";
import { canSeeSalaries } from "@/server/auth/session";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { projectPaymentSplit, projectSpend } from "@/server/services/metrics";
import { PROJECT_STAGES, type ProjectStage, type ProjectStatus } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { emptySpendByType, originalBudgetOf, spendTypeOf, type SpendByType } from "@/lib/project-cost-types";
import { forecastProjectCost, type ProjectForecast } from "../project-forecast";
import { isClosed } from "./model";

/**
 * Project cost figures for the project analytics pages. Spend is always the shared measure
 * (projectSpend in src/server/services/metrics.ts): every expense booked to the project, stock it
 * used included, with salaries left out for members. The split by category reads the same
 * expenses with the same salary rule, so it adds up to the same total.
 */

export type CategorySpend = { category: string; label: string; amount: number };

export type ProjectCostRow = {
  id: string;
  code: string;
  name: string;
  client: string | null;
  status: ProjectStatus;
  color: string;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  originalBudget: number;
  budgetHistory: { budget: number; changedAt: string }[];
  stageBudgets: Record<ProjectStage, number>;
  spent: number;
  byType: SpendByType;
  byStage: Record<ProjectStage, number>;
  /** Spend on expenses without a stage, so the stages add up to `spent`. */
  noStage: number;
  byCategory: CategorySpend[];
  expenseCount: number;
  /** Paid to vendors out of `spent` (projectPaymentSplit, the same expenses and salary rule). */
  paid: number;
  /** Still owed to vendors out of `spent`; paid + outstanding = spent. */
  outstanding: number;
  /** The part of outstanding past its due date. */
  overdue: number;
  /** Budget minus spent; negative when over budget. Also the variance. */
  remainingBudget: number;
  /** Budget not spent yet on open projects (0 when over budget, 0 when closed). */
  estimatedRemaining: number;
  /** spent / budget; null without a budget. */
  utilisation: number | null;
  /** Spent above the budget; 0 within it or without a budget. */
  overrun: number;
  /** The shared project cost forecast (src/features/analytics/project-forecast.ts). */
  prediction: ProjectForecast;
  /** Predicted final cost above the budget by the spend rate; null without a rate prediction or a budget. */
  predictedOverrun: number | null;
};

export type ProjectCosts = { rows: ProjectCostRow[]; total: number; salariesHidden: boolean };

type ProjectLean = {
  _id: Types.ObjectId;
  code: string;
  name: string;
  client?: string | null;
  status: ProjectStatus;
  color?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  budget: number;
  budgetHistory?: { budget: number; changedAt: Date }[] | null;
  stageBudgets?: Partial<Record<ProjectStage, number>> | null;
};

/** Spend per project and category, with the salary rule of projectSpend. */
async function categorySpend(ids: Types.ObjectId[], includeSalaries: boolean) {
  const rows = await Expense.aggregate<{ _id: { project: Types.ObjectId; category: string }; total: number }>([
    { $match: { project: { $in: ids }, ...(includeSalaries ? {} : { category: { $ne: "salaries" } }) } },
    { $group: { _id: { project: "$project", category: "$category" }, total: { $sum: "$amount" } } },
  ]);
  const out = new Map<string, { category: string; amount: number }[]>();
  for (const r of rows) {
    const id = String(r._id.project);
    const list = out.get(id) ?? [];
    list.push({ category: r._id.category, amount: round2(r.total) });
    out.set(id, list);
  }
  return out;
}

/** Every project (or those with the given statuses) with its spend, split and outlook. */
export async function loadProjectCosts(statuses: ProjectStatus[] | null, now: Date = new Date()): Promise<ProjectCosts> {
  await connectDB();
  const includeSalaries = await canSeeSalaries();
  const [projects, total, labelOf] = await Promise.all([
    Project.find(statuses ? { status: { $in: statuses } } : {}, {
      code: 1,
      name: 1,
      client: 1,
      status: 1,
      color: 1,
      startDate: 1,
      endDate: 1,
      budget: 1,
      budgetHistory: 1,
      stageBudgets: 1,
    })
      .sort({ createdAt: -1 })
      .lean<ProjectLean[]>(),
    Project.countDocuments({}),
    getExpenseCategoryLabeler(),
  ]);
  const ids = projects.map((p) => p._id);
  const [spend, categories, payables] = await Promise.all([
    projectSpend(ids, { includeSalaries }),
    categorySpend(ids, includeSalaries),
    projectPaymentSplit(ids, { includeSalaries, now }),
  ]);
  const today = toDateInput(now);

  const rows = projects.map((p): ProjectCostRow => {
    const id = String(p._id);
    const s = spend.get(id);
    const spent = s?.spent ?? 0;
    const paid = payables.get(id)?.paid ?? 0;
    const byType = emptySpendByType();
    const byCategory = (categories.get(id) ?? [])
      .map((c) => ({ ...c, label: labelOf(c.category) }))
      .sort((a, b) => b.amount - a.amount);
    for (const c of byCategory) {
      const t = spendTypeOf(c.category);
      byType[t] = round2(byType[t] + c.amount);
    }
    const byStage = s?.byStage ?? (Object.fromEntries(PROJECT_STAGES.map((st) => [st.value, 0])) as Record<ProjectStage, number>);
    const staged = PROJECT_STAGES.reduce((sum, st) => sum + byStage[st.value], 0);
    const budget = p.budget ?? 0;
    const remainingBudget = round2(budget - spent);
    const closed = isClosed(p.status);
    const startDate = p.startDate ? toDateInput(p.startDate) : null;
    const endDate = p.endDate ? toDateInput(p.endDate) : null;
    const prediction = forecastProjectCost({ status: p.status, startDate, endDate, budget, spent }, today);
    return {
      id,
      code: p.code,
      name: p.name,
      client: p.client ?? null,
      status: p.status,
      color: p.color ?? "#4a82cc",
      startDate,
      endDate,
      budget,
      originalBudget: originalBudgetOf(budget, p.budgetHistory),
      budgetHistory: (p.budgetHistory ?? []).map((h) => ({ budget: h.budget, changedAt: new Date(h.changedAt).toISOString() })),
      stageBudgets: Object.fromEntries(PROJECT_STAGES.map((st) => [st.value, p.stageBudgets?.[st.value] ?? 0])) as Record<ProjectStage, number>,
      spent,
      byType,
      byStage,
      noStage: round2(spent - staged),
      byCategory,
      expenseCount: s?.expenseCount ?? 0,
      paid,
      outstanding: round2(spent - paid),
      overdue: payables.get(id)?.overdue ?? 0,
      remainingBudget,
      estimatedRemaining: closed ? 0 : Math.max(0, remainingBudget),
      utilisation: budget > 0 ? spent / budget : null,
      overrun: budget > 0 ? Math.max(0, round2(spent - budget)) : 0,
      prediction,
      predictedOverrun: prediction.basis === "rate" ? prediction.variance : null,
    };
  });
  return { rows, total, salariesHidden: !includeSalaries };
}
