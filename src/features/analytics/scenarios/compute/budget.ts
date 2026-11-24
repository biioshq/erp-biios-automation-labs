import { BUDGET_HEADS, DEPARTMENTS, PROJECT_STAGES, labelOf, type BudgetHead, type Department, type ProjectStage } from "@/lib/constants";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { BudgetInputs } from "../schemas";
import type { ResultTable, ScenarioResults } from "../types";
import type { ComputeContext, ProjectFact } from "./facts";
import { SALARIES_NOTE, compareRow, daysBetween, emptyMetrics, periodDays, round2, stat, sumOf, viewOf } from "./common";
import { headCategoryLabels, headOfCategory } from "./budget-heads";

export type BudgetFacts = {
  /** Spend in the period for the scope (project, department or company), per expense category. */
  byCategory: { category: string; label: string; amount: number }[];
  /**
   * Project scope only: spend booked before the period, per category. A project or stage budget
   * covers the whole project, so it counts too. Null for department and company budgets, which
   * are for the period alone.
   */
  priorByCategory?: { category: string; label: string; amount: number }[] | null;
  /** Project scope: the project with lifetime spend per stage. */
  project: ProjectFact | null;
  /** Project scope: spend in the period per stage, for the chosen head. */
  stagePeriod: { stage: ProjectStage; amount: number }[];
};

export type RunRate = { days: number; elapsed: number; remaining: number; spent: number; perDay: number | null; expected: number | null };

/** Spend so far in the period and where it lands at the same daily rate by the period end. */
export function runRate(spent: number, from: string, to: string, today: string): RunRate {
  const days = periodDays(from, to);
  const end = today < to ? today : to;
  const elapsed = today < from ? 0 : Math.min(days, daysBetween(from, end) + 1);
  const remaining = days - elapsed;
  const perDay = elapsed > 0 ? spent / elapsed : null;
  // Before the period starts there is no rate to go by: expected stays unknown unless spend is already booked in it.
  const expected = remaining === 0 ? round2(spent) : perDay !== null ? round2(spent + perDay * remaining) : spent > 0 ? round2(spent) : null;
  return { days, elapsed, remaining, spent: round2(spent), perDay, expected };
}

/**
 * The allocation against the spend it has to cover. `partial` = only spend already booked is known
 * (a project budget whose period has not started): what is left and the funding gap are then
 * minimums, and savings cannot be told yet.
 */
function position(allocation: number, spend: number | null, partial = false) {
  return {
    allocation: round2(allocation),
    remaining: spend !== null ? round2(allocation - spend) : round2(allocation),
    utilisation: spend !== null && allocation > 0 ? spend / allocation : null,
    savings: spend !== null && !partial ? round2(Math.max(0, allocation - spend)) : null,
    funding: spend !== null ? round2(Math.max(0, spend - allocation)) : null,
  };
}

function scopeLabel(inputs: BudgetInputs, project: ProjectFact | null): string {
  if (inputs.scope === "project") return `${project?.name ?? "The project"}${inputs.stage ? `, ${labelOf(PROJECT_STAGES, inputs.stage).toLowerCase()} stage` : ""}`;
  if (inputs.scope === "department") return labelOf(DEPARTMENTS, inputs.department as Department);
  return "The whole business";
}

/** 1.5 Budget planning: a revised allocation against spend so far and its run rate. */
export function computeBudget(inputs: BudgetInputs, facts: BudgetFacts, ctx: ComputeContext): ScenarioResults {
  const inHead = (category: string) => !inputs.head || headOfCategory(category) === inputs.head;
  const lines = facts.byCategory.filter((c) => inHead(c.category));
  const spent = sumOf(lines, (c) => c.amount);
  const prior = facts.priorByCategory ? sumOf(facts.priorByCategory.filter((c) => inHead(c.category)), (c) => c.amount) : 0;
  const rate = runRate(spent, inputs.periodFrom, inputs.periodTo, ctx.today);
  // What the allocation has to cover: the period's expected spend, plus earlier spend for a project budget.
  const expected = rate.expected !== null ? round2(prior + rate.expected) : null;
  const original = round2(inputs.currentBudget);
  const proposed = round2(inputs.mode === "amount" ? (inputs.proposedBudget ?? original) : original + (inputs.change ?? 0));
  const diff = round2(proposed - original);
  // Before the period starts a project budget still carries what is already booked to the project.
  const partial = expected === null && Boolean(facts.priorByCategory) && prior > 0;
  const covered = partial ? prior : expected;
  const before = position(original, covered, partial);
  const after = position(proposed, covered, partial);
  const label = scopeLabel(inputs, facts.project);
  const headText = inputs.head ? labelOf(BUDGET_HEADS, inputs.head) : "all budget heads";
  const share = (amount: number) => (rate.elapsed > 0 && rate.remaining > 0 ? round2(amount + (amount / rate.elapsed) * rate.remaining) : round2(amount));

  // Heads (or categories within the chosen head) and where each lands at its own rate.
  const groups = new Map<string, { label: string; spent: number }>();
  for (const c of lines) {
    const key = inputs.head ? c.category : headOfCategory(c.category);
    const name = inputs.head ? c.label : labelOf(BUDGET_HEADS, key as BudgetHead);
    const g = groups.get(key) ?? { label: name, spent: 0 };
    g.spent = round2(g.spent + c.amount);
    groups.set(key, g);
  }
  const groupRows = [...groups.entries()].sort((a, b) => b[1].spent - a[1].spent);

  const tables: ResultTable[] = [
    {
      key: "spend",
      title: inputs.head ? `Spend in ${labelOf(BUDGET_HEADS, inputs.head)} by category` : "Spend by budget head",
      description: `${
        inputs.head
          ? `Counts these expense categories: ${headCategoryLabels(inputs.head)}.`
          : "Expenses are booked by category; each category counts under one head. No allocation per head is recorded, so heads are shown against the whole allocation."
      }${facts.priorByCategory ? ` Only spend in the period is listed; the ${formatCurrency(prior)} booked to the project before it is counted in the expected expenditure above.` : ""}`,
      columns: [
        { key: "name", header: inputs.head ? "Category" : "Budget head", type: "text" },
        { key: "spent", header: "Spent in period", type: "money" },
        { key: "expected", header: "Expected in period", type: "money" },
        { key: "share", header: "Share of proposed budget", type: "percent" },
      ],
      rows: groupRows.map(([, g]) => ({ cells: { name: g.label, spent: g.spent, expected: share(g.spent), share: proposed > 0 ? share(g.spent) / proposed : null } })),
      totals: groupRows.length ? { name: "Total", spent, expected: rate.expected } : null,
      emptyText: "No expense is recorded for this scope in the period yet.",
    },
  ];

  const overStages: string[] = [];
  if (facts.project) {
    const p = facts.project;
    const periodBy = new Map(facts.stagePeriod.map((s) => [s.stage, s.amount]));
    tables.push({
      key: "stages",
      title: "Stage budgets",
      description: "Each stage's budget against its spend to date, and where it lands if the period's spend in that stage carries on at the same rate.",
      columns: [
        { key: "stage", header: "Stage", type: "text" },
        { key: "budget", header: "Stage budget", type: "money" },
        { key: "spent", header: "Spent to date", type: "money" },
        { key: "period", header: "Spent in period", type: "money" },
        { key: "projected", header: "Projected", type: "money" },
        { key: "used", header: "Projected use", type: "percent" },
      ],
      rows: PROJECT_STAGES.map((s) => {
        const budget = p.stageBudgets[s.value] ?? 0;
        const spentStage = p.stageSpent[s.value] ?? 0;
        const inPeriod = periodBy.get(s.value) ?? 0;
        const projected = round2(spentStage + (share(inPeriod) - inPeriod));
        const over = budget > 0 ? projected > budget : projected > 0 && Object.values(p.stageBudgets).some((v) => v > 0);
        if (over) overStages.push(s.label);
        return {
          cells: { stage: s.label, budget, spent: spentStage, period: inPeriod, projected, used: budget > 0 ? projected / budget : null },
          tone: over ? ("danger" as const) : budget > 0 && projected > budget * 0.9 ? ("warning" as const) : undefined,
        };
      }),
      totals: { stage: "Total", budget: sumOf(PROJECT_STAGES, (s) => p.stageBudgets[s.value] ?? 0), spent: sumOf(PROJECT_STAGES, (s) => p.stageSpent[s.value] ?? 0) },
    });
  }

  const metrics = emptyMetrics();
  metrics.budgetChange = diff;
  metrics.overBudget = after.funding;
  if (after.funding) metrics.risks.push(`Expected spend is ${formatCurrency(after.funding)} above the proposed budget`);
  for (const s of overStages) metrics.risks.push(`${s} stage may exceed its budget`);

  const notes = [
    `Expected expenditure is the spend booked in the period so far (${rate.elapsed} of ${rate.days} days), carried on at the same daily rate to the period end${
      facts.priorByCategory ? `, plus ${formatCurrency(prior)} booked to the project before the period, since a project budget covers its whole life` : ""
    }.`,
    inputs.scope === "department"
      ? "Department spend counts only expenses that have a department set."
      : inputs.scope === "overall"
        ? "Company spend leaves out the project cost of stock that was already expensed when it was bought, so nothing is counted twice."
        : "Project spend includes stock the project used, as on the project page.",
    inputs.head ? `${labelOf(BUDGET_HEADS, inputs.head)} counts these expense categories: ${headCategoryLabels(inputs.head)}.` : "All expense categories count.",
  ];
  if (rate.expected === null) {
    notes.push(
      partial
        ? `The period has not started and nothing is booked in it yet, so there is no run rate to project from. Remaining and utilisation count only the ${formatCurrency(prior)} already booked to the project, so they will change once spend in the period is booked.`
        : "The period has not started and nothing is booked in it yet, so there is no run rate to project from.",
    );
  }
  if (!ctx.salaries) notes.push(SALARIES_NOTE);

  const day = (d: string) => formatDate(fromDateInput(d));
  return {
    version: 1,
    type: "budget",
    computedAt: new Date().toISOString(),
    view: viewOf(ctx),
    headline: `${label} (${headText}), ${day(inputs.periodFrom)} to ${day(inputs.periodTo)}: the budget moves from ${formatCurrency(original)} to ${formatCurrency(proposed)}. ${
      expected === null
        ? partial
          ? `${formatCurrency(prior)} is already booked to the project, leaving ${formatCurrency(after.remaining)} before any spend in the period. There is no spend in the period yet to project from.`
          : "There is no spend in the period yet to project from."
        : after.funding
          ? `Expected spend of ${formatCurrency(expected)} needs ${formatCurrency(after.funding)} more.`
          : `Expected spend of ${formatCurrency(expected)} leaves ${formatCurrency(after.remaining)}${after.utilisation !== null ? ` (${formatPercent(after.utilisation)} used)` : ""}.`
    }`,
    stats: [
      stat("proposed", "Proposed budget", "money", proposed, { hint: `${diff >= 0 ? "+" : ""}${formatCurrency(diff)} on ${formatCurrency(original)}` }),
      stat("expected", "Expected expenditure", "money", expected, {
        hint: facts.priorByCategory ? `${formatCurrency(round2(prior + spent))} spent so far, ${formatCurrency(prior)} before the period` : `${formatCurrency(spent)} spent so far`,
      }),
      stat("utilisation", partial ? "Utilisation so far" : "Expected utilisation", "percent", after.utilisation, { tone: after.utilisation !== null && after.utilisation > 1 ? "danger" : "default" }),
      after.funding
        ? stat("funding", "Additional funding needed", "money", after.funding, { tone: "danger" })
        : stat("savings", "Potential savings", "money", after.savings, { tone: after.savings ? "success" : "default" }),
    ],
    comparison: [
      compareRow("allocation", "Allocated budget", "money", before.allocation, after.allocation),
      ...(facts.priorByCategory ? [compareRow("prior", "Spent on the project before the period", "money", prior, prior)] : []),
      compareRow("expected", "Expected expenditure", "money", expected, expected),
      compareRow("remaining", "Remaining budget", "money", before.remaining, after.remaining),
      compareRow("utilisation", "Utilisation", "percent", before.utilisation, after.utilisation),
      compareRow("funding", "Additional funding needed", "money", before.funding, after.funding),
      compareRow("savings", "Potential savings", "money", before.savings, after.savings),
      { key: "change", parameter: "Change in allocation", type: "percent", current: null, scenario: original > 0 ? diff / original : null, difference: null },
    ],
    tables,
    chart:
      groupRows.length > 1
        ? {
            title: "Spend by head: so far and expected",
            type: "money",
            currentLabel: "Spent so far",
            scenarioLabel: "Expected in period",
            points: groupRows.map(([, g]) => ({ label: g.label, current: g.spent, scenario: share(g.spent) })),
          }
        : null,
    metrics,
    notes,
    notRecorded: inputs.head || inputs.scope !== "project" ? [] : [{ label: "Budgets per head", detail: "Projects record budgets per stage, not per head, so heads are compared with the whole allocation." }],
  };
}
