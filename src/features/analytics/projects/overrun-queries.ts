import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense } from "@/server/models";
import { canSeeSalaries } from "@/server/auth/session";
import { PROJECT_STAGES, type ProjectStage } from "@/lib/constants";
import { fromDateInput, monthKeyIST, startOfMonthIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { budgetAt } from "./model";
import type { ProjectCostRow } from "./queries";

/**
 * Cost overruns (5.4). A project overruns when its spend is above its current budget. Stage
 * overruns compare a stage's spend with the stage budget, where one is set. The trend is the
 * project's cumulative spend month by month against the budget in force at the end of that month
 * (from the budget history). Spend follows projectSpend's salary rule.
 */

export type StageOverrun = { projectId: string; projectName: string; color: string; stage: ProjectStage; stageLabel: string; planned: number; spent: number; over: number };

export type TrendPoint = { month: string; label: string; monthSpend: number; cumulative: number; budget: number };

/** Stages spending above their own budget, worst first. */
export function stageOverruns(rows: ProjectCostRow[]): StageOverrun[] {
  return rows
    .flatMap((p) =>
      PROJECT_STAGES.filter((s) => (p.stageBudgets[s.value] ?? 0) > 0 && p.byStage[s.value] > p.stageBudgets[s.value]).map((s) => ({
        projectId: p.id,
        projectName: p.name,
        color: p.color,
        stage: s.value,
        stageLabel: s.label,
        planned: p.stageBudgets[s.value],
        spent: p.byStage[s.value],
        over: round2(p.byStage[s.value] - p.stageBudgets[s.value]),
      })),
    )
    .sort((a, b) => b.over - a.over);
}

const MAX_MONTHS = 36;

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Monthly and cumulative spend of one project against the budget in force each month. */
export async function spendTrend(p: ProjectCostRow, now: Date = new Date()): Promise<{ points: TrendPoint[]; trimmed: boolean }> {
  await connectDB();
  const includeSalaries = await canSeeSalaries();
  const rows = await Expense.aggregate<{ _id: string; total: number }>([
    { $match: { project: new Types.ObjectId(p.id), ...(includeSalaries ? {} : { category: { $ne: "salaries" } }) } },
    { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } }, total: { $sum: "$amount" } } },
  ]);
  if (!rows.length) return { points: [], trimmed: false };
  const byMonth = new Map(rows.map((r) => [r._id, round2(r.total)]));
  const firstSpend = [...byMonth.keys()].sort()[0];
  const lastSpend = [...byMonth.keys()].sort().at(-1)!;
  const startKey = p.startDate && p.startDate.slice(0, 7) < firstSpend ? p.startDate.slice(0, 7) : firstSpend;
  const nowKey = monthKeyIST(now);
  const endKey = lastSpend > nowKey ? lastSpend : nowKey;

  const keys: string[] = [];
  for (let d = fromDateInput(`${startKey}-01`); monthKeyIST(d) <= endKey; d = startOfMonthIST(d, 1)) keys.push(monthKeyIST(d));
  let cumulative = 0;
  const all = keys.map((k) => {
    const month = byMonth.get(k) ?? 0;
    cumulative = round2(cumulative + month);
    // The budget in force on the last day of the month (today for the current month).
    const monthEnd = k === nowKey ? now : new Date(startOfMonthIST(fromDateInput(`${k}-01`), 1).getTime() - 1);
    return { month: k, label: monthLabel(k), monthSpend: month, cumulative, budget: budgetAt(monthEnd, p.budget, p.budgetHistory) };
  });
  return { points: all.length > MAX_MONTHS ? all.slice(-MAX_MONTHS) : all, trimmed: all.length > MAX_MONTHS };
}

/** The first month a project went over the budget in force, from its trend; null when it never did. */
export function firstOverrunMonth(points: TrendPoint[]): string | null {
  return points.find((pt) => pt.budget > 0 && pt.cumulative > pt.budget)?.month ?? null;
}
