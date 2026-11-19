import "server-only";

import { connectDB } from "@/server/db";
import { Project } from "@/server/models";
import { budgetUsage, projectSpend } from "@/server/services/metrics";
import { PROJECT_STAGES, PROJECT_STATUSES, labelOf, type ProjectStatus } from "@/lib/constants";
import { formatDate, round2 } from "@/lib/format";
import { col, day, objectIds, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow } from "../../types";

const columns = [
  col("code", "Code", "text", 11),
  col("name", "Project", "text", 28),
  col("client", "Client", "text", 22),
  col("status", "Status", "text", 12),
  col("budget", "Budget", "money", 15),
  col("spent", "Spent", "money", 15),
  col("remaining", "Remaining", "money", 15),
  col("usage", "Budget used", "percent", 11),
  col("income", "Income", "money", 15),
  col("profit", "Profit", "money", 15),
  ...PROJECT_STAGES.map((s) => col(`stage_${s.value}`, s.label, "money", 13)),
  col("start", "Start", "date", 13),
  col("end", "End", "date", 13),
];

/** Lifetime figures per project: budget against spend (by stage) and income. Dates filters do not apply. */
export async function buildProjectReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const only = new Set(f.project.filter((p) => p !== "none"));
  const usage = (await budgetUsage()).filter((p) => !only.size || only.has(p.id));
  const ids = usage.map((u) => u.id);
  const [spend, docs] = await Promise.all([
    projectSpend(ids),
    Project.find({ _id: { $in: objectIds(ids) } }, { client: 1, startDate: 1, endDate: 1 }).lean(),
  ]);
  const meta = new Map(docs.map((d) => [String(d._id), d]));

  const rows: ReportRow[] = usage
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((p) => {
      const s = spend.get(p.id);
      const m = meta.get(p.id);
      const income = s?.income ?? 0;
      const row: ReportRow = {
        code: p.code,
        name: p.name,
        client: m?.client ?? "",
        status: labelOf(PROJECT_STATUSES, p.status as ProjectStatus),
        budget: p.budget,
        spent: p.spent,
        remaining: p.remaining,
        usage: p.usage,
        income,
        profit: round2(income - p.spent),
        start: day(m?.startDate),
        end: day(m?.endDate),
      };
      for (const st of PROJECT_STAGES) row[`stage_${st.value}`] = s?.byStage[st.value] ?? 0;
      return row;
    });

  const totals = sumTotals(columns, rows);
  totals.usage = Number(totals.budget) > 0 ? Number(totals.spent) / Number(totals.budget) : 0;
  const overBudget = rows.filter((r) => Number(r.remaining) < 0).length;

  return {
    type: "project",
    title: "Project report",
    subtitle: `Lifetime figures as of ${formatDate(new Date())}${only.size ? ` · ${rows.length} selected projects` : ""}`,
    columns,
    rows,
    totals,
    summary: [
      { label: "Projects", value: rows.length, type: "number" },
      { label: "Total budget", value: Number(totals.budget), type: "money" },
      { label: "Total spent", value: Number(totals.spent), type: "money" },
      { label: "Income received", value: Number(totals.income), type: "money" },
      { label: "Net profit", value: Number(totals.profit), type: "money" },
      { label: "Over budget", value: overBudget, type: "number" },
    ],
  };
}
