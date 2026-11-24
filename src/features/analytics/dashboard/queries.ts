import "server-only";

import { inventorySnapshot } from "@/server/services/metrics";
import { round2 } from "@/lib/format";
import {
  activeBudgetUse,
  ageingBuckets,
  maintenanceDue,
  manpower,
  monthlyStock,
  projectCosts,
  projectHealth,
  requirementTotals,
  stockOutlook,
  velocityBuckets,
} from "./measures";
import { TREND_MONTHS } from "./rules";
import type { AnalyticsDashboard } from "./types";

const CHART_PROJECTS = 8;

/**
 * Everything on the Analytics dashboard. Members get project spend without salaries (as on every
 * project page); nothing here is a P&L, cash or balance-sheet figure.
 */
export async function getAnalyticsDashboard(viewer: { isAdmin: boolean }, now: Date = new Date()): Promise<AnalyticsDashboard> {
  const includeSalaries = viewer.isAdmin;
  const [projects, stock, inventory, months, maintenance, people] = await Promise.all([
    projectHealth(includeSalaries, now),
    stockOutlook(now),
    inventorySnapshot(),
    monthlyStock(TREND_MONTHS, now),
    maintenanceDue(now),
    manpower(now),
  ]);

  const active = projects.filter((p) => p.status === "active");
  // Overruns by the shared forecast rule, as on Project cost forecast and Cost overruns: open
  // projects with a budget that are over it by the forecast or already.
  const budgeted = projects.filter((p) => p.forecast && p.budget > 0);
  const overruns = budgeted.filter((p) => (p.forecast?.overrun ?? 0) > 0);
  const atRisk = active.filter((p) => p.atRisk);

  // Charts compare the projects that are open now, biggest spend first.
  const open = projects.filter((p) => p.status === "active" || p.status === "on_hold" || p.status === "planning");
  const bySpend = [...open].sort((a, b) => b.spent - a.spent || b.budget - a.budget).slice(0, CHART_PROJECTS);
  const [costs, ageing, velocity] = await Promise.all([
    projectCosts(
      bySpend.filter((p) => p.spent > 0).map((p) => ({ id: p.id, name: p.name })),
      includeSalaries,
    ),
    ageingBuckets(now),
    velocityBuckets(now),
  ]);

  return {
    cards: {
      shortages: {
        count: stock.alerts.length,
        out: stock.alerts.filter((a) => a.level === "out").length,
        belowMin: stock.alerts.filter((a) => a.level === "below_min").length,
        runsOut: stock.alerts.filter((a) => a.level === "runs_out").length,
      },
      purchases: requirementTotals(stock.requirements),
      overruns: {
        count: overruns.length,
        amount: round2(overruns.reduce((s, p) => s + (p.forecast?.overrun ?? 0), 0)),
        budgeted: budgeted.length,
        rated: budgeted.filter((p) => p.forecast?.basis === "rate").length,
        spendToDate: budgeted.filter((p) => p.forecast?.basis === "spend_to_date").length,
        noForecast: budgeted.filter((p) => p.forecast?.basis === "none").length,
      },
      delays: {
        count: atRisk.length,
        overdueTasks: active.reduce((s, p) => s + p.tasks.overdue, 0),
        pastEnd: active.filter((p) => p.pastEnd).length,
        active: active.length,
      },
      budget: activeBudgetUse(projects),
      maintenance: { due: maintenance.filter((m) => !m.overdue).length, overdue: maintenance.filter((m) => m.overdue).length },
      manpower: { overAllocated: people.overAllocated.length, unstaffed: people.unstaffed.length },
      inventory: { value: inventory.value, items: inventory.items, allocatedValue: inventory.allocatedValue },
    },
    months,
    projectCosts: costs,
    budgetRows: bySpend.filter((p) => p.budget > 0 || p.spent > 0).map((p) => ({ id: p.id, label: p.name, budget: p.budget, spent: p.spent })),
    performance: active.map((p) => ({
      id: p.id,
      label: p.name,
      time: p.timeElapsed,
      budget: p.usage,
      tasks: p.tasks.total > 0 ? p.tasks.done / p.tasks.total : null,
    })),
    ageing,
    velocity,
    salariesHidden: !includeSalaries,
  };
}
