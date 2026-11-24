import type { ProjectStatus } from "@/lib/constants";
import type { ProjectForecast } from "../project-forecast";
import type { BudgetUse } from "../projects/model";

/** Client-safe shapes for the Analytics dashboard and the management insights pages. */

export type ProjectHealth = {
  id: string;
  code: string;
  name: string;
  color: string;
  status: ProjectStatus;
  client: string | null;
  budget: number;
  /** Project spend from projectSpend (salaries left out for members). */
  spent: number;
  /** spent / budget; null without a budget. */
  usage: number | null;
  contractValue: number | null;
  startDate: string | null;
  endDate: string | null;
  tasks: { total: number; done: number; overdue: number };
  /** Active and its end date has passed. */
  pastEnd: boolean;
  /** Active with overdue tasks or past its end date. */
  atRisk: boolean;
  /** Share of the planned days (start to end) gone by today; null without both dates. */
  timeElapsed: number | null;
  /**
   * The shared project cost forecast (src/features/analytics/project-forecast.ts) for open
   * projects, as on Project cost forecast and Cost overruns. Null for closed projects.
   */
  forecast: ProjectForecast | null;
};

export type PurchaseRequirement = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  available: number;
  minStock: number;
  /** Units used per day, when the item has enough history to forecast; null otherwise. */
  perDay: number | null;
  leadTimeDays: number | null;
  /** The day to order by: stockout minus lead time, today when that has passed or there is no rate. */
  reorderDate: string;
  orderNow: boolean;
  qty: number;
  /** forecast: covers the horizon plus lead time at the rate; minimum: back to the minimum level only. */
  basis: "forecast" | "minimum";
  price: number | null;
  priceBasis: "last_purchase" | "average" | null;
  estimatedCost: number | null;
  /** The stock alert level from the shared look-ahead alerts, when it is one. */
  alert: "out" | "below_min" | "runs_out" | null;
};

export type MonthlyStock = {
  month: string;
  /** Value issued to projects less value returned (assign − return). */
  consumed: number;
  wasted: number;
  /** Stock bought through the ERP (purchase entries with an expense). */
  bought: number;
  /** Stock entered as opening or imported stock (purchase entries without an expense). */
  opening: number;
};

export type Bucket = { key: string; label: string; items: number; value: number };

export type ProjectCostRow = {
  id: string;
  name: string;
  material: number;
  labour: number;
  equipment: number;
  transport: number;
  other: number;
  total: number;
};

export type MaintenanceDue = {
  id: string;
  code: string;
  name: string;
  lastDate: string | null;
  lastDescription: string | null;
  dueDate: string;
  /** recorded: the next due date on the latest entry; interval: last service plus the average gap. */
  basis: "recorded" | "interval";
  dueIn: number;
  overdue: boolean;
};

export type EmployeeLoad = {
  id: string;
  name: string;
  department: string;
  /** Current allocation in percent: memberships on active or on-hold projects that have started and not ended. */
  allocation: number;
  projects: { id: string; name: string; allocation: number }[];
};

export type Manpower = {
  employees: EmployeeLoad[];
  overAllocated: EmployeeLoad[];
  unstaffed: { id: string; name: string; code: string }[];
};

export type DashboardCards = {
  shortages: { count: number; out: number; belowMin: number; runsOut: number };
  purchases: { count: number; cost: number; unknownCost: number };
  /** Open projects with a budget: over it by the forecast or already (count, amount), and how each was judged. */
  overruns: { count: number; amount: number; budgeted: number; rated: number; spendToDate: number; noForecast: number };
  delays: { count: number; overdueTasks: number; pastEnd: number; active: number };
  /** Budget used by active projects with a budget (budgetUse). */
  budget: BudgetUse;
  maintenance: { due: number; overdue: number };
  manpower: { overAllocated: number; unstaffed: number };
  inventory: { value: number; items: number; allocatedValue: number };
};

export type AnalyticsDashboard = {
  cards: DashboardCards;
  months: MonthlyStock[];
  projectCosts: ProjectCostRow[];
  budgetRows: { id: string; label: string; budget: number; spent: number }[];
  performance: { id: string; label: string; time: number | null; budget: number | null; tasks: number | null }[];
  ageing: Bucket[];
  velocity: Bucket[];
  salariesHidden: boolean;
};
