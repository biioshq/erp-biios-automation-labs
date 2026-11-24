import type { AssetCondition, ProjectStage } from "@/lib/constants";

/**
 * Recorded data a scenario is computed from, loaded by server/loader.ts. Plain values only, so the
 * compute functions stay pure and can be tested with hand-made numbers.
 */

export type ItemFact = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  /** In storage, free to issue. */
  available: number;
  minStock: number;
  leadTimeDays: number | null;
  /** Weighted average cost of the stock on hand. */
  averageCost: number;
  lastPurchasePrice: number | null;
  /** Net units issued per day over the usage window (analytics core); null without recorded use. */
  perDay: number | null;
  windowDays: number;
  vendor: string | null;
};

/** An open assignment of stock to a project. */
export type AllocationFact = {
  projectId: string;
  itemId: string;
  /** Units the project holds (assigned less returned), wasted units included. */
  quantity: number;
  /** Units still in use: quantity less units wasted on the project. */
  inUse: number;
  unitCost: number;
  assignedAt: string;
};

export type ProjectFact = {
  id: string;
  name: string;
  code: string;
  status: string;
  color: string;
  budget: number;
  /** Spend so far (metrics.projectSpend); without salaries for members. */
  spent: number;
  stageBudgets: Record<ProjectStage, number>;
  stageSpent: Record<ProjectStage, number>;
  startDate: string | null;
  endDate: string | null;
};

export type EmployeeFact = {
  id: string;
  name: string;
  department: string;
  designation: string | null;
  skills: string[];
  /** Null for viewers who do not see salaries. */
  monthlySalary: number | null;
};

/** A current project membership: no end date, or one after today. */
export type MembershipFact = {
  projectId: string;
  employeeId: string;
  role: string;
  /** Share of the person's time, 0 to 100. */
  allocation: number;
};

export type EquipmentFact = {
  id: string;
  code: string;
  name: string;
  quantity: number;
  condition: AssetCondition;
  projectId: string | null;
  projectName: string | null;
  /** "yyyy-mm-dd"; null = no end recorded. */
  projectUntil: string | null;
};

export type CashFact = { total: number; accounts: { name: string; balance: number }[] };

/** Who the figures are for and the day they are computed on. */
export type ComputeContext = {
  /** "yyyy-mm-dd" (IST). */
  today: string;
  /** The viewer may see salaries (pay and salary expenses). */
  salaries: boolean;
  /** The viewer may see cash, bank and P&L figures. */
  cash: boolean;
};
