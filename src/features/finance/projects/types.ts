import type { FileDTO } from "@/features/files/types";
import type { ProjectStage, ProjectStatus } from "@/lib/constants";

/** What blocks a project from being deleted. */
export type ProjectLinks = { expenses: number; income: number; allocations: number; tasks: number };

/** A project with its live budget numbers. Used by cards, the table, the form and the detail header. */
export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  client: string | null;
  description: string | null;
  status: ProjectStatus;
  color: string;
  budget: number;
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

export type ProjectsSummary = {
  count: number;
  activeCount: number;
  totalBudget: number;
  totalSpent: number;
  remaining: number;
};

export type ProjectDetail = ProjectRow & {
  byStage: Record<ProjectStage, number>;
  /** Value of stock the project holds right now (held quantity x unit cost). */
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
