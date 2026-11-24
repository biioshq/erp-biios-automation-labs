import "server-only";

import { financeTotals, inventorySnapshot } from "@/server/services/metrics";
import { endOfDayIST, financialYearIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { activeBudgetUse, projectHealth, requirementTotals, stockOutlook } from "../dashboard/measures";
import { viewerPayables } from "./shared";
import type { BusinessInsights } from "./types";

const TOP = 8;

/** 6.1 Overall business performance: projects, money committed and spent, stock, and what is owed. */
export async function getBusinessInsights(viewer: { isAdmin: boolean }, now: Date = new Date()): Promise<BusinessInsights> {
  const fy = financialYearIST(now);
  const [projects, stock, inventory, payables, totals] = await Promise.all([
    projectHealth(viewer.isAdmin, now),
    stockOutlook(now),
    inventorySnapshot(),
    viewerPayables(viewer.isAdmin, now),
    financeTotals({ from: fy.start, to: endOfDayIST(now) }),
  ]);
  const count = (s: string) => projects.filter((p) => p.status === s).length;
  // Cancelled projects are not part of the work the company is delivering.
  const live = projects.filter((p) => p.status !== "cancelled");
  const valued = live.filter((p) => p.contractValue !== null);
  return {
    counts: {
      total: projects.length,
      planning: count("planning"),
      active: count("active"),
      onHold: count("on_hold"),
      completed: count("completed"),
      cancelled: count("cancelled"),
      delayed: projects.filter((p) => p.atRisk).length,
    },
    value: { total: round2(valued.reduce((s, p) => s + (p.contractValue ?? 0), 0)), withValue: valued.length, projects: live.length },
    budget: { total: round2(live.reduce((s, p) => s + p.budget, 0)), projects: live.length },
    spent: round2(live.reduce((s, p) => s + p.spent, 0)),
    companyExpenses: { amount: totals.expenses, label: fy.label },
    budgetUse: activeBudgetUse(projects),
    inventory: { value: inventory.value, items: inventory.items, lowStock: inventory.lowStock, outOfStock: inventory.outOfStock },
    payables: payables.totals,
    topVendors: payables.byVendor.slice(0, TOP),
    requirements: stock.requirements.slice(0, TOP),
    requirementTotals: requirementTotals(stock.requirements),
    projects: live,
    salariesHidden: !viewer.isAdmin,
  };
}
