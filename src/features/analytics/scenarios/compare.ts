import { round2 } from "@/lib/format";
import type { ScenarioStatus, ScenarioType } from "@/lib/constants";
import type { Cell, ScenarioResults, ValueType } from "./types";
import { formatQtyList } from "./compute/common";

/**
 * The comparison matrix: one column for the current business position, one per scenario. Impact
 * rows measure change from today, so today's column is zero there by definition. Position rows show
 * the business as recorded today and as it would stand once each scenario plays out. A null cell
 * means the measure does not apply to that scenario type (shown as a dash). Client-safe and pure.
 */

export type BusinessPosition = {
  /** Budgets of projects not completed or cancelled. */
  budgets: number;
  /** Their spend so far (salaries left out for members). */
  spent: number;
  activePeople: number;
  freeFte: number;
  /** Only for viewers who see cash figures. */
  cash: number | null;
};

export type CompareColumn = {
  id: string;
  code: string;
  name: string;
  type: ScenarioType;
  status: ScenarioStatus;
  /** "saved" or "today": which figures the column shows. */
  basis: "saved" | "today";
  savedAt: string | null;
  results: ScenarioResults | null;
  error: string | null;
};

export type CompareRow = {
  key: string;
  label: string;
  group: "impact" | "position";
  type: ValueType | "list";
  current: Cell | string[];
  values: (Cell | string[])[];
  /** Lower is better (costs, shortages): the page marks the best and worst scenario. */
  lowerIsBetter?: boolean;
};

type Metric = (r: ScenarioResults) => Cell;

const IMPACT: { key: string; label: string; type: ValueType; pick: Metric; lowerIsBetter?: boolean }[] = [
  { key: "materials", label: "Additional material required", type: "text", pick: (r) => (r.metrics.materials ? formatQtyList(r.metrics.materials) : null) },
  { key: "procurement", label: "Additional procurement cost", type: "money", pick: (r) => r.metrics.procurementCost, lowerIsBetter: true },
  { key: "projectCost", label: "Project cost impact", type: "money", pick: (r) => r.metrics.projectCost, lowerIsBetter: true },
  { key: "budgetChange", label: "Budget change", type: "money", pick: (r) => r.metrics.budgetChange },
  { key: "overBudget", label: "Spend above budget", type: "money", pick: (r) => r.metrics.overBudget, lowerIsBetter: true },
  { key: "people", label: "Manpower: people to hire (+) or surplus (-)", type: "number", pick: (r) => r.metrics.manpowerPeople, lowerIsBetter: true },
  { key: "peopleCost", label: "Manpower cost", type: "money", pick: (r) => r.metrics.manpowerCost, lowerIsBetter: true },
  { key: "equipmentShort", label: "Equipment units short", type: "number", pick: (r) => r.metrics.equipmentShort, lowerIsBetter: true },
  { key: "equipmentCost", label: "Equipment cost", type: "money", pick: (r) => r.metrics.equipmentCost, lowerIsBetter: true },
  { key: "delay", label: "Potential project delay (days)", type: "number", pick: (r) => r.metrics.delayDays, lowerIsBetter: true },
  { key: "shortItems", label: "Materials that would run short", type: "number", pick: (r) => r.metrics.shortItems, lowerIsBetter: true },
];

/** Cash a scenario takes: its own estimate when it has one, else what it buys and the extra people it pays. */
export function cashTaken(r: ScenarioResults): number {
  if (r.metrics.cashNeed !== null) return r.metrics.cashNeed;
  return round2(Math.max(0, r.metrics.procurementCost ?? 0) + Math.max(0, r.metrics.equipmentCost ?? 0) + Math.max(0, r.metrics.manpowerCost ?? 0));
}

export function compareMatrix(position: BusinessPosition, columns: CompareColumn[]): CompareRow[] {
  const val = (c: CompareColumn, pick: Metric): Cell => (c.results ? pick(c.results) : null);
  const rows: CompareRow[] = IMPACT.map((m) => ({
    key: m.key,
    label: m.label,
    group: "impact",
    type: m.type,
    current: m.type === "text" ? "None" : 0,
    values: columns.map((c) => val(c, m.pick)),
    lowerIsBetter: m.lowerIsBetter,
  }));
  rows.push({ key: "risks", label: "Potential operational risks", group: "impact", type: "list", current: [], values: columns.map((c) => c.results?.metrics.risks ?? []) });

  const budgetsAfter = (r: ScenarioResults) => round2(position.budgets + (r.metrics.budgetChange ?? 0));
  const spentAfter = (r: ScenarioResults) => round2(position.spent + (r.metrics.projectCost ?? 0));
  rows.push(
    { key: "budgets", label: "Budgets of open projects", group: "position", type: "money", current: position.budgets, values: columns.map((c) => val(c, budgetsAfter)) },
    { key: "spent", label: "Spend of open projects, with the scenario's cost", group: "position", type: "money", current: position.spent, values: columns.map((c) => val(c, spentAfter)), lowerIsBetter: true },
    {
      key: "utilisation",
      label: "Budget utilisation",
      group: "position",
      type: "percent",
      current: position.budgets > 0 ? position.spent / position.budgets : null,
      values: columns.map((c) => val(c, (r) => (budgetsAfter(r) > 0 ? spentAfter(r) / budgetsAfter(r) : null))),
      lowerIsBetter: true,
    },
    {
      key: "headcount",
      label: "Active people, with hires needed",
      group: "position",
      type: "number",
      current: position.activePeople,
      values: columns.map((c) => val(c, (r) => position.activePeople + Math.max(0, r.metrics.manpowerPeople ?? 0))),
    },
  );
  if (position.cash !== null) {
    const cash = position.cash;
    rows.push({ key: "cash", label: "Cash and bank after the scenario's spending", group: "position", type: "money", current: cash, values: columns.map((c) => val(c, (r) => round2(cash - cashTaken(r)))) });
  }
  return rows;
}
