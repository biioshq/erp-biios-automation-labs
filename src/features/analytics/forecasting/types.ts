import type { AssetCondition, ProjectStatus, StockStatus } from "@/lib/constants";
import type { Horizon } from "./constants";

/** Plain data the forecasting pages pass to client components. Client-safe. */

/**
 * forecast: enough history and a rate. no_use: old enough, but nothing consumed in the window.
 * insufficient: too few movements or too short a record to forecast.
 */
export type ForecastStatus = "forecast" | "no_use" | "insufficient";

export type DemandRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  available: number;
  /** In use on projects: open assignments less units wasted there (as Inventory counts it). */
  allocated: number;
  minStock: number;
  leadTimeDays: number | null;
  unitPrice: number;
  value: number;
  stockStatus: StockStatus;
  /** Over the window (from the shared usage measure). */
  issued: number;
  returned: number;
  consumed: number;
  wasted: number;
  /** Movements of any kind in the window. */
  movements: number;
  /** Assignments and returns in the window: what the history rule counts. */
  useMovements: number;
  /** Units per day (consumed ÷ rateDays); null unless the item has enough history (status "forecast"). */
  perDay: number | null;
  /** Days the window's use is spread over: from the first assignment in the window to its end, at least MIN_HISTORY_DAYS. */
  rateDays: number | null;
  firstMovement: string | null;
  historyDays: number | null;
  status: ForecastStatus;
  /** Why there is no forecast, in plain words. */
  reason: string | null;
  /** Expected use over each horizon; null without a rate. */
  predicted: Record<Horizon, number> | null;
  daysOfCover: number | null;
  stockoutDate: string | null;
  orderBy: string | null;
  /** Units beyond what is available to cover the next 30 days of use. */
  extraNeeded: number | null;
  /** Why the item may be overstocked, when it may be. */
  overstock: string | null;
  /** With a project filter: what that project consumed in the window. */
  projectConsumed: number | null;
};

export type ShortageRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  available: number;
  minStock: number;
  level: "out" | "below_min" | "runs_out";
  reasons: string[];
  stockoutDate: string | null;
  orderBy: string | null;
  suggestedQty: number | null;
  /** A run-out alert for a material the history rule does not forecast (its date is rough). */
  limitedHistory: boolean;
};

export type ProjectUseRow = {
  projectId: string;
  name: string;
  code: string;
  color: string;
  status: ProjectStatus;
  materials: number;
  /** Value of stock assigned less stock returned in the window. */
  value: number;
};

export type MonthPoint = {
  /** "2026-11" */
  month: string;
  consumedValue: number;
  consumedQty: number;
  wastedValue: number;
  wastedQty: number;
  wastageCount: number;
  adjustmentsUp: number;
  adjustmentsDown: number;
};

export type PurchaseRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  categoryName: string | null;
  available: number;
  allocated: number;
  minStock: number;
  perDay: number | null;
  status: ForecastStatus;
  reason: string | null;
  leadTimeDays: number | null;
  /** Use over the horizon plus lead time; null without a rate. */
  requirement: number | null;
  suggestedQty: number;
  /** How the suggestion was reached. */
  basis: "forecast" | "minimum" | "none";
  reorderDate: string | null;
  /** Days past the order-by date (0 when on time). */
  lateBy: number;
  stockoutDate: string | null;
  price: number | null;
  priceBasis: "last_purchase" | "average" | null;
  estimatedCost: number | null;
};

export type ProjectCategorySpend = { value: string; label: string; amount: number; share: number };

export type ProjectForecastRow = {
  id: string;
  name: string;
  code: string;
  client: string | null;
  color: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  originalBudget: number;
  spent: number;
  /** spent / budget; null without a budget. */
  usedShare: number | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
  /** Average spend per day since the start; only set when the forecast uses it. */
  dailyRate: number | null;
  /** Run rate × days left to the planned end; null with the reason in runRateNote. */
  runRateRemaining: number | null;
  runRateNote: string | null;
  /** max(0, budget − spent): budget not spent yet. A fact, never part of the prediction. */
  budgetRemaining: number;
  /**
   * The shared project forecast rule (src/features/analytics/project-forecast.ts). run_rate: spent
   * plus the run rate to the planned end. spend_to_date: past the planned end or on hold, the
   * spend so far. none: no figure (forecastNote says why).
   */
  method: "run_rate" | "spend_to_date" | "none";
  /** The mark shown beside the figure, e.g. "Past planned end, spend to date". */
  methodLabel: string | null;
  /** What the figure rests on, or why there is none. */
  forecastNote: string;
  /** Null when there is no figure. */
  predictedTotal: number | null;
  /**
   * predictedTotal − budget for a run rate; for spend to date or no figure, only spend already
   * above the budget (a late project never shows a saving). Null without a budget or when unknown.
   */
  variance: number | null;
  missing: string[];
  pastEnd: boolean;
  categories: ProjectCategorySpend[];
};

export type SpendPoint = {
  month: string;
  /** Cumulative recorded spend at the month's end; null for future months. */
  actual: number | null;
  /** Cumulative spend projected at the run rate; null before this month. */
  projected: number | null;
};

export type MaintenanceEntry = {
  date: string;
  description: string;
  cost: number;
  vendor: string | null;
  nextDueDate: string | null;
};

export type EquipmentRow = {
  id: string;
  code: string;
  name: string;
  groupLabel: string;
  condition: AssetCondition;
  location: string | null;
  projectName: string | null;
  lastMaintenance: string | null;
  history: MaintenanceEntry[];
  nextDue: string | null;
  nextBasis: "recorded" | "interval" | null;
  intervalDays: number | null;
  nextNote: string | null;
  /** Days from today to nextDue; negative when overdue. */
  dueIn: number | null;
  attention: string[];
  averageCost: number | null;
  costEntries: number;
  warrantyUntil: string | null;
};

export type PersonLoad = {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  department: string;
  departmentLabel: string;
  status: string;
  /** Sum of allocation % on projects running now. */
  current: number;
  /** Sum of allocation % on projects that have not started (planning, or a later start date). */
  upcoming: number;
  /** Highest allocation % at any one time from now to the end of the timeline (current work included). */
  peak: number;
  projects: { id: string; name: string; role: string; allocation: number; upcoming: boolean }[];
  /** Admins only: monthly cost of the allocation above 100%, at this person's pay. Missing for members. */
  excessMonthlyCost?: number;
};

export type DepartmentLoad = {
  department: string;
  label: string;
  headcount: number;
  currentFte: number;
  upcomingFte: number;
  /** Allocated FTE in the busiest month ahead (current work included). */
  peakFte: number;
  /** headcount − peakFte (negative is a shortage). */
  spareFte: number;
  overAllocated: number;
};

export type RoleLoad = { role: string; people: number; currentFte: number; upcomingFte: number; projects: number };

export type ProjectManpower = {
  id: string;
  name: string;
  code: string;
  color: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  members: number;
  fte: number;
  roles: string[];
};

export type ManpowerMonth = {
  month: string;
  /** Active people's allocated full-time equivalents at the month's busiest point. */
  demandFte: number;
  /** Active employees. */
  headcount: number;
  /** Active people above 100% at some point in that month. */
  overPeople: number;
};

export type AccuracyRow = {
  id: string;
  kind: "material_demand" | "project_cost";
  key: string;
  label: string;
  month: string;
  from: string;
  to: string;
  unit: string | null;
  basis: string | null;
  predicted: number;
  actual: number;
  /** actual − predicted. */
  difference: number;
  /** difference / predicted. */
  deviation: number;
  /** 1 − |deviation|, never below 0. */
  accuracy: number;
};

export type AccuracyByMonth = {
  month: string;
  material: number | null;
  materialCount: number;
  project: number | null;
  projectCount: number;
};

export type AccuracyByKey = {
  kind: "material_demand" | "project_cost";
  key: string;
  label: string;
  unit: string | null;
  comparisons: number;
  predicted: number;
  actual: number;
  /** Mean accuracy over its comparisons. */
  accuracy: number;
};

export type UnusualChange = {
  direction: "up" | "down";
  /** Daily rate over the last 30 days and over the 90 days before them. */
  recentPerDay: number;
  priorPerDay: number;
  text: string;
};

export type ConsumptionRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  categoryName: string | null;
  status: ForecastStatus;
  reason: string | null;
  /** Assigned less returned over the history window. */
  consumed: number;
  /** consumed ÷ window days, as recorded (shown for every item with use, forecast or not). */
  measuredPerDay: number | null;
  /** Use in the last 28 days and the 28 days before. */
  last4Weeks: number;
  prev4Weeks: number;
  /** last4Weeks ÷ prev4Weeks − 1; null when the earlier period had no use. */
  trend: number | null;
  /** Expected use in the next 30 days; only with enough history. */
  next30: number | null;
  unusual: UnusualChange | null;
  wasted: number;
  wastedValue: number;
  /** wasted ÷ (consumed + units wasted from storage): units wasted on a project are already in consumed. */
  wastageShare: number | null;
  available: number;
  daysOfCover: number | null;
  stockoutDate: string | null;
};
