import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Project } from "@/server/models";
import { projectSpend } from "@/server/services/metrics";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { addDays, endOfDayIST, fromDateInput, monthKeyIST, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { originalBudgetOf } from "@/lib/project-cost-types";
import { forecastProjectCost } from "../../project-forecast";
import type { ProjectStatus } from "@/lib/constants";
import type { ProjectCategorySpend, ProjectForecastRow, SpendPoint } from "../types";
import { monthKeys } from "./history";

/**
 * Project cost forecast for open projects (planning, active, on hold), from recorded spend only.
 * The forecast itself is the shared rule in src/features/analytics/project-forecast.ts (the same
 * one Project cost analysis, Cost overruns and the dashboard use): spent + spend rate x days left
 * to the planned end, or spend to date once the planned end has passed or the project is on hold,
 * or no figure with the reason. Unspent budget is never assumed to be spent.
 * Spend is projectSpend's, so salaries are left out for members unless includeSalaries says otherwise.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN: ProjectStatus[] = ["planning", "active", "on_hold"];

type Options = { includeSalaries?: boolean; now?: Date; projectIds?: string[] };

/** The viewer's default, imported lazily so scripts can pass includeSalaries without a request. */
async function seesSalaries(options: Options): Promise<boolean> {
  if (options.includeSalaries !== undefined) return options.includeSalaries;
  const { canSeeSalaries } = await import("@/server/auth/session");
  return canSeeSalaries();
}

/** Expense match exactly as projectSpend builds it. */
const spendMatch = (ids: Types.ObjectId[], includeSalaries: boolean) => ({
  project: { $in: ids },
  ...(includeSalaries ? {} : { category: { $ne: "salaries" } }),
});

async function categoriesByProject(ids: Types.ObjectId[], includeSalaries: boolean): Promise<Map<string, ProjectCategorySpend[]>> {
  const [rows, label] = await Promise.all([
    Expense.aggregate<{ _id: { project: Types.ObjectId; category: string }; total: number }>([
      { $match: spendMatch(ids, includeSalaries) },
      { $group: { _id: { project: "$project", category: "$category" }, total: { $sum: "$amount" } } },
    ]),
    getExpenseCategoryLabeler(),
  ]);
  const out = new Map<string, ProjectCategorySpend[]>();
  for (const r of rows) {
    const key = String(r._id.project);
    const list = out.get(key) ?? [];
    list.push({ value: r._id.category, label: label(r._id.category) || "Uncategorised", amount: round2(r.total), share: 0 });
    out.set(key, list);
  }
  for (const list of out.values()) {
    const total = list.reduce((s, c) => s + c.amount, 0);
    for (const c of list) c.share = total > 0 ? c.amount / total : 0;
    list.sort((a, b) => b.amount - a.amount);
  }
  return out;
}

/** Forecast rows for open projects (or the given ones), largest budget first. */
export async function projectCostForecast(options: Options = {}): Promise<ProjectForecastRow[]> {
  await connectDB();
  const includeSalaries = await seesSalaries(options);
  const now = options.now ?? new Date();
  const today = toDateInput(now);
  const projects = await Project.find(
    options.projectIds ? { _id: { $in: options.projectIds.map((id) => new Types.ObjectId(id)) } } : { status: { $in: OPEN } },
    { name: 1, code: 1, client: 1, color: 1, status: 1, budget: 1, budgetHistory: 1, startDate: 1, endDate: 1 },
  )
    .sort({ budget: -1, name: 1 })
    .lean();
  if (!projects.length) return [];
  const ids = projects.map((p) => p._id);
  const [spend, categories] = await Promise.all([projectSpend(ids, { includeSalaries }), categoriesByProject(ids, includeSalaries)]);

  return projects.map((p) => {
    const id = String(p._id);
    const spent = spend.get(id)?.spent ?? 0;
    const budget = p.budget ?? 0;
    const start = p.startDate ?? null;
    const end = p.endDate ?? null;
    const startDate = start ? toDateInput(start) : null;
    const endDate = end ? toDateInput(end) : null;
    const f = forecastProjectCost({ status: p.status, startDate, endDate, budget, spent }, today);
    const method: ProjectForecastRow["method"] = f.basis === "rate" ? "run_rate" : f.basis === "spend_to_date" ? "spend_to_date" : "none";
    const missing = [!start ? "Start date" : null, !end ? "Planned end date" : null, budget <= 0 ? "Budget" : null].filter((m): m is string => Boolean(m));
    return {
      id,
      name: p.name,
      code: p.code,
      client: p.client ?? null,
      color: p.color ?? "#4a82cc",
      status: p.status as ProjectStatus,
      startDate,
      endDate,
      budget,
      originalBudget: originalBudgetOf(budget, p.budgetHistory),
      spent,
      usedShare: budget > 0 ? spent / budget : null,
      daysElapsed: f.daysElapsed,
      daysRemaining: f.daysRemaining,
      dailyRate: f.dailyRate,
      runRateRemaining: f.basis === "rate" && f.value !== null ? round2(f.value - spent) : null,
      runRateNote: f.basis === "rate" ? null : f.note,
      budgetRemaining: round2(Math.max(0, budget - spent)),
      method,
      methodLabel: f.label,
      forecastNote: f.note,
      predictedTotal: f.basis === "rate" || f.basis === "spend_to_date" ? f.value : null,
      variance: f.variance,
      missing,
      pastEnd: Boolean(endDate && endDate < today),
      categories: categories.get(id) ?? [],
    };
  });
}

/**
 * Cumulative spend of one project by month, from its start (or first expense) to its planned end,
 * with the run-rate projection from this month on when there is a rate.
 */
export async function projectSpendSeries(row: ProjectForecastRow, options: Pick<Options, "includeSalaries" | "now"> = {}): Promise<SpendPoint[]> {
  await connectDB();
  const includeSalaries = await seesSalaries(options);
  const now = options.now ?? new Date();
  const id = new Types.ObjectId(row.id);
  const monthly = await Expense.aggregate<{ _id: string; total: number; first: Date }>([
    { $match: { ...spendMatch([id], includeSalaries), date: { $lte: endOfDayIST(now) } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } }, total: { $sum: "$amount" }, first: { $min: "$date" } } },
  ]);
  const firstExpense = monthly.reduce<Date | null>((m, r) => (!m || r.first < m ? r.first : m), null);
  const starts = [row.startDate ? fromDateInput(row.startDate) : null, firstExpense].filter((d): d is Date => Boolean(d));
  if (!starts.length) return [];
  const from = new Date(Math.min(...starts.map((d) => d.getTime())));
  const endDate = row.endDate ? fromDateInput(row.endDate) : null;
  const to = endDate && endDate > now ? endDate : now;
  const byMonth = new Map(monthly.map((r) => [r._id, r.total]));
  const current = monthKeyIST(now);
  const today = startOfDayIST(now);
  const spentNow = round2(monthly.reduce((s, r) => s + r.total, 0));

  let running = 0;
  return monthKeys(from, to).map((month) => {
    let actual: number | null = null;
    if (month <= current) {
      running += byMonth.get(month) ?? 0;
      actual = round2(running);
    }
    let projected: number | null = null;
    if (row.dailyRate !== null && month >= current && endDate) {
      // Projected to the month's last day, or the planned end when that comes first.
      const monthEnd = addDays(startOfMonthIST(fromDateInput(`${month}-01`), 1), -1);
      const until = monthEnd < endDate ? monthEnd : endDate;
      const days = Math.max(0, Math.round((startOfDayIST(until).getTime() - today.getTime()) / DAY_MS));
      projected = month === current ? spentNow : round2(spentNow + row.dailyRate * days);
    }
    return { month, actual, projected };
  });
}
