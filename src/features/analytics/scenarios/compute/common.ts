import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { formatNumber, round2 } from "@/lib/format";
import type { Cell, ComparisonRow, ResultStat, ResultTable, ScenarioMetrics, ValueType } from "../types";
import type { ItemFact, ProjectFact } from "./facts";

/** Shared pieces of the scenario calculations. Pure and client-safe. */

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export { round2 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from one "yyyy-mm-dd" to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateInput(to).getTime() - fromDateInput(from).getTime()) / DAY_MS);
}

/** Calendar days a period covers, both ends included. */
export function periodDays(from: string, to: string): number {
  return Math.max(0, daysBetween(from, to) + 1);
}

export function shiftDate(date: string, days: number): string {
  return toDateInput(addDays(fromDateInput(date), days));
}

/** Months a period covers, as a decimal (30.44 days a month). Not rounded: costs multiply by it. */
export function periodMonths(from: string, to: string): number {
  return periodDays(from, to) / 30.44;
}

export function emptyMetrics(): ScenarioMetrics {
  return {
    materials: null,
    procurementCost: null,
    projectCost: null,
    budgetChange: null,
    overBudget: null,
    manpowerPeople: null,
    manpowerCost: null,
    equipmentShort: null,
    equipmentCost: null,
    delayDays: null,
    shortItems: null,
    cashNeed: null,
    risks: [],
  };
}

/** Units that only come whole: a requirement of 105.6 pieces means 106. */
const WHOLE_UNITS = new Set(["pcs", "set", "box", "roll", "sheet", "pair"]);
export function wholeUp(qty: number, unit: string): number {
  return WHOLE_UNITS.has(unit) ? Math.ceil(round3(qty)) : round3(qty);
}

export type PriceBasis = "last_purchase" | "average";

/** The unit price a material is costed at, and which price that is. Falls back to the average when no purchase price is recorded. */
export function priceOf(item: Pick<ItemFact, "averageCost" | "lastPurchasePrice">, basis: PriceBasis): { price: number; basis: PriceBasis; fellBack: boolean } {
  if (basis === "last_purchase") {
    if (item.lastPurchasePrice !== null && item.lastPurchasePrice > 0) return { price: item.lastPurchasePrice, basis, fellBack: false };
    return { price: item.averageCost, basis: "average", fellBack: true };
  }
  return { price: item.averageCost, basis, fellBack: false };
}

export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = { last_purchase: "Last purchase price", average: "Average cost" };

/** Sums quantities per unit ("pcs", "m"), dropping zeros. */
export function qtyByUnit(lines: { unit: string; qty: number }[]): { unit: string; qty: number }[] {
  const by = new Map<string, number>();
  for (const l of lines) by.set(l.unit, round3((by.get(l.unit) ?? 0) + l.qty));
  return [...by.entries()].filter(([, q]) => q !== 0).map(([unit, qty]) => ({ unit, qty }));
}

export function formatQtyList(list: { unit: string; qty: number }[] | null): string {
  if (!list || !list.length) return "0";
  return list.map((l) => `${formatNumber(l.qty)} ${l.unit}`).join(", ");
}

export function stat(key: string, label: string, type: ValueType, value: Cell, extra: Partial<ResultStat> = {}): ResultStat {
  return { key, label, type, value, ...extra };
}

/** A current-versus-scenario row. The difference is worked out for numbers and left empty otherwise. */
export function compareRow(key: string, parameter: string, type: ValueType, current: Cell, scenario: Cell, unit?: string): ComparisonRow {
  const numeric = typeof current === "number" && typeof scenario === "number" && type !== "date" && type !== "text";
  const diff = numeric ? (type === "money" ? round2(scenario - current) : type === "percent" ? scenario - current : round3(scenario - current)) : null;
  return { key, parameter, type, unit, current, scenario, difference: diff };
}

/**
 * Splits an amount across projects in proportion to their weights (their recorded use), or equally
 * when none has any. Rounded to the paisa with the remainder on the last project, so the parts add up.
 */
export function splitAmount(total: number, projectIds: string[], weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (!projectIds.length) return out;
  const sum = projectIds.reduce((s, id) => s + Math.max(0, weights.get(id) ?? 0), 0);
  let given = 0;
  projectIds.forEach((id, i) => {
    if (i === projectIds.length - 1) {
      out.set(id, round2(total - given));
      return;
    }
    const share = sum > 0 ? Math.max(0, weights.get(id) ?? 0) / sum : 1 / projectIds.length;
    const part = round2(total * share);
    out.set(id, part);
    given = round2(given + part);
  });
  return out;
}

/** True when the split followed recorded use rather than equal shares. */
export function splitIsWeighted(projectIds: string[], weights: Map<string, number>): boolean {
  return projectIds.some((id) => (weights.get(id) ?? 0) > 0);
}

/**
 * Budget, spend so far and the scenario's extra cost per project, with the new utilisation.
 * `overBudget` is the spend above budget after the scenario that was not already over before it.
 */
export function budgetImpactTable(projects: ProjectFact[], extra: Map<string, number>, title = "Impact on project budgets"): { table: ResultTable; overBudget: number; projectCost: number } {
  let overBudget = 0;
  let projectCost = 0;
  const rows = projects.map((p) => {
    const add = extra.get(p.id) ?? 0;
    projectCost = round2(projectCost + add);
    const after = round2(p.spent + add);
    const overBefore = Math.max(0, p.spent - p.budget);
    const overAfter = Math.max(0, after - p.budget);
    overBudget = round2(overBudget + Math.max(0, overAfter - overBefore));
    const tone: "danger" | "warning" | undefined = p.budget > 0 && after > p.budget ? "danger" : p.budget > 0 && after > p.budget * 0.9 ? "warning" : undefined;
    return {
      cells: {
        project: `${p.name} (${p.code})`,
        budget: p.budget,
        spent: p.spent,
        used: p.budget > 0 ? p.spent / p.budget : null,
        extra: add,
        after,
        usedAfter: p.budget > 0 ? after / p.budget : null,
        remaining: round2(p.budget - after),
      },
      links: { project: `/finance/projects/${p.id}` },
      tone,
    };
  });
  return {
    overBudget,
    projectCost,
    table: {
      key: "budget-impact",
      title,
      description: "Spent so far is every expense booked to the project, stock it used included. Remaining after is the budget less spent and the scenario's extra cost.",
      columns: [
        { key: "project", header: "Project", type: "text" },
        { key: "budget", header: "Budget", type: "money" },
        { key: "spent", header: "Spent so far", type: "money" },
        { key: "used", header: "Used now", type: "percent" },
        { key: "extra", header: "Scenario extra cost", type: "money" },
        { key: "after", header: "Spent after scenario", type: "money" },
        { key: "usedAfter", header: "Used after", type: "percent" },
        { key: "remaining", header: "Remaining after", type: "money" },
      ],
      rows,
      totals: projects.length > 1 ? { project: "Total", budget: sumOf(projects, (p) => p.budget), spent: sumOf(projects, (p) => p.spent), extra: projectCost, after: round2(sumOf(projects, (p) => p.spent) + projectCost), remaining: round2(sumOf(projects, (p) => p.budget) - sumOf(projects, (p) => p.spent) - projectCost) } : null,
      emptyText: "No project picked, so no project budget is affected.",
    },
  };
}

export function sumOf<T>(rows: readonly T[], pick: (r: T) => number): number {
  return round2(rows.reduce((s, r) => s + pick(r), 0));
}

export const SALARIES_NOTE = "Project spend leaves out salary expenses: only admins see them.";
