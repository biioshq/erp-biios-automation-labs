import type { FileDTO } from "@/features/files/types";
import type { ProjectStage, ProjectStatus } from "@/lib/constants";
import type { ProjectFinance, ProjectOutlook } from "./finance";

/** What blocks a project from being deleted. */
export type ProjectLinks = {
  expenses: number;
  income: number;
  allocations: number;
  tasks: number;
  /** Recurring schedules that are not ended (they would keep posting to a deleted project). */
  schedules: number;
};

/** A project with its live budget numbers. Used by cards, the table, the form and the detail header. */
export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  client: string | null;
  description: string | null;
  status: ProjectStatus;
  color: string;
  /** The current (revised) budget. */
  budget: number;
  /** The first recorded budget (the budget itself when it never changed). */
  originalBudget: number;
  /** What the client pays for the whole project; null when not recorded. */
  contractValue: number | null;
  stageBudgets: Record<ProjectStage, number>;
  startDate: string | null;
  endDate: string | null;
  spent: number;
  remaining: number;
  /** spent / budget (0 when there is no budget). */
  usage: number;
  income: number;
  expenseCount: number;
  links: ProjectLinks;
  createdAt: string;
};

/** A project with its revenue, spend by type and forecast figures (list, profitability, budgets). */
export type ProjectFinanceRow = ProjectRow & { finance: ProjectFinance; outlook: ProjectOutlook };

/** One earlier budget, as kept in Project.budgetHistory. */
export type BudgetChange = {
  /** The budget before this change. */
  budget: number;
  changedAt: string;
  changedBy: string | null;
  note: string | null;
};

export type ProjectsSummary = {
  count: number;
  activeCount: number;
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  /** Sum of recorded contract values, and how many projects have one. */
  totalContractValue: number;
  withContractValue: number;
  totalRevenue: number;
  totalReceived: number;
  totalOutstanding: number;
};

export type ProjectDetail = ProjectFinanceRow & {
  /** Earlier budgets, oldest first. */
  budgetHistory: BudgetChange[];
  byStage: Record<ProjectStage, number>;
  /** Value of stock the project holds right now (held quantity x the unit cost charged at assignment). */
  inventoryValue: number;
  openTasks: number;
  /** People currently on the project (memberships without an end date). */
  teamSize: number;
  createdBy: string | null;
};

export type StageRow = {
  stage: ProjectStage;
  label: string;
  planned: number;
  spent: number;
  /** planned - spent (negative = over the stage budget). Null when no stage budget was set. */
  variance: number | null;
  /** Share of total spend, 0 to 1. */
  share: number;
};

export type InventoryUsedRow = {
  id: string;
  item: { id: string; name: string; sku: string; unit: string } | null;
  quantityHeld: number;
  quantityReturned: number;
  quantityAssigned: number;
  unitCost: number;
  totalCost: number;
  assignedAt: string;
  stage: ProjectStage;
};

export type TimelineKind =
  | "created"
  | "expense"
  | "income"
  | "assigned"
  | "returned"
  | "task_created"
  | "task_completed"
  | "document"
  | "start"
  | "end";

export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  /** ISO instant. */
  at: string;
  title: string;
  detail: string | null;
  amount: number | null;
  href: string | null;
};

export type ProjectDocument = FileDTO;
export type ExpenseReceipt = { file: FileDTO; expense: { id: string; number: string; vendor: string } };
