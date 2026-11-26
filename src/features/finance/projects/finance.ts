import { round2 } from "@/lib/format";
import type { ProjectStage, ProjectStatus } from "@/lib/constants";
import type { SpendByType } from "@/lib/project-cost-types";
import type { PaymentSplit } from "@/server/services/metrics";

/**
 * Project money, derived one way for the projects list, profitability, budget tracking and the
 * project page, so the four never disagree. Client-safe and pure: the figures come from the
 * shared queries (projectSpend for spend, invoiceBalances and income for revenue).
 */

// The spend types and the original budget rule live in src/lib/project-cost-types.ts (shared with
// the analytics pages); re-exported here so existing imports keep working.
export { SPEND_TYPES, emptySpendByType, originalBudgetOf, spendTypeOf } from "@/lib/project-cost-types";
export type { SpendByType, SpendType } from "@/lib/project-cost-types";

/**
 * What a project earned and was paid.
 *  - invoiced: customer invoices for the project (cancelled ones left out)
 *  - receivedOnInvoices: income records linked to those invoices
 *  - receivedDirect: income records for the project not linked to an invoice that carries a project
 *  - revenue = invoiced + receivedDirect (a receipt against an invoice is part of the invoice, never added twice)
 *  - received = receivedOnInvoices + receivedDirect
 *  - outstanding: what the project's invoices still have to receive
 */
export type ProjectRevenue = {
  invoiced: number;
  invoiceCount: number;
  receivedOnInvoices: number;
  receivedDirect: number;
  received: number;
  revenue: number;
  outstanding: number;
  overdue: number;
};

export const emptyRevenue = (): ProjectRevenue => ({
  invoiced: 0,
  invoiceCount: 0,
  receivedOnInvoices: 0,
  receivedDirect: 0,
  received: 0,
  revenue: 0,
  outstanding: 0,
  overdue: 0,
});

export type ProjectFinance = {
  projectId: string;
  /** Total project expenditure, from projectSpend (salaries left out for members). */
  spent: number;
  byType: SpendByType;
  /** Spend per stage, from projectSpend. */
  byStage: Record<ProjectStage, number>;
  expenseCount: number;
  revenue: ProjectRevenue;
  /**
   * What was paid to vendors and what is still owed, out of `spent` (projectPaymentSplit in
   * src/server/services/metrics.ts). incurred is the spend, so paid + outstanding = spent.
   */
  payables: ProjectPayables;
  salariesHidden: boolean;
};

export type { PaymentSplit };

/** Spend split into paid and outstanding, for the project and per stage. */
export type ProjectPayables = PaymentSplit & {
  byStage: Record<ProjectStage, PaymentSplit>;
  /** Expenses without a stage. */
  noStage: PaymentSplit;
};

const zeroSplit = (): PaymentSplit => ({ incurred: 0, paid: 0, outstanding: 0, overdue: 0 });

export const emptyPayables = (stages: readonly ProjectStage[]): ProjectPayables => ({
  ...zeroSplit(),
  byStage: Object.fromEntries(stages.map((s) => [s, zeroSplit()])) as Record<ProjectStage, PaymentSplit>,
  noStage: zeroSplit(),
});

export type OutlookInput = {
  status: ProjectStatus;
  /** The current (revised) budget. */
  budget: number;
  originalBudget: number;
  contractValue: number | null;
  spent: number;
  revenue: number;
};

export type ProjectOutlook = {
  /** Completed or cancelled: nothing more is expected to be spent. */
  closed: boolean;
  /** Revised budget minus original budget (positive when the budget was raised). */
  budgetRevision: number;
  /** Revised budget minus spent; negative when over budget. Also the budget variance. */
  remainingBudget: number;
  /** spent / revised budget; null without a budget. */
  utilisation: number | null;
  /** Spent above the revised budget, 0 when within it or without a budget. */
  overrun: number;
  /** Budget not spent yet (0 when over budget). 0 for closed projects: they spend nothing more. */
  estimatedRemaining: number;
  /** spent + estimatedRemaining. */
  expectedFinalCost: number;
  /** The contract value when one is recorded, otherwise the revenue so far. */
  projectValue: number;
  valueBasis: "contract" | "revenue";
  /** projectValue minus expectedFinalCost. */
  estimatedProfit: number;
  /** estimatedProfit / projectValue; null when the value is 0. */
  margin: number | null;
  /** Unspent budget of a closed project; null while the project is still open (not known yet). */
  potentialSavings: number | null;
};

/** Forecast figures for one project, from recorded numbers only (no invented rates). */
export function projectOutlook(p: OutlookInput): ProjectOutlook {
  const closed = p.status === "completed" || p.status === "cancelled";
  const remainingBudget = round2(p.budget - p.spent);
  const estimatedRemaining = closed ? 0 : Math.max(0, remainingBudget);
  const expectedFinalCost = round2(p.spent + estimatedRemaining);
  const valueBasis = p.contractValue !== null ? "contract" : "revenue";
  const projectValue = valueBasis === "contract" ? (p.contractValue ?? 0) : p.revenue;
  const estimatedProfit = round2(projectValue - expectedFinalCost);
  return {
    closed,
    budgetRevision: round2(p.budget - p.originalBudget),
    remainingBudget,
    utilisation: p.budget > 0 ? p.spent / p.budget : null,
    overrun: p.budget > 0 ? Math.max(0, round2(p.spent - p.budget)) : 0,
    estimatedRemaining,
    expectedFinalCost,
    projectValue,
    valueBasis,
    estimatedProfit,
    margin: projectValue > 0 ? estimatedProfit / projectValue : null,
    potentialSavings: closed && p.budget > 0 ? Math.max(0, remainingBudget) : null,
  };
}

/** Sums the money fields of many rows (totals rows and headline cards). */
export function sumBy<T>(rows: T[], pick: (row: T) => number): number {
  return round2(rows.reduce((s, r) => s + pick(r), 0));
}
