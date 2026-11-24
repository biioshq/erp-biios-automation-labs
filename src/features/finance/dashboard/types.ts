import type { ProjectStatus } from "@/lib/constants";
import type { DashboardPeriod } from "./periods";

export type DashboardKpis = {
  income: number;
  expenses: number;
  profit: number;
  /** Profit as a share of income, null when there is no income. */
  margin: number | null;
  gstPaid: number;
  incomeDelta: number | null;
  expenseDelta: number | null;
  profitDelta: number | null;
  /**
   * Average spend per calendar month: the company expenses of whole months (1st to the last day)
   * divided by how many months. Null before a whole month of records exists.
   */
  monthlyAverage: MonthlyAverage | null;
  /** Spent this calendar month so far. */
  monthToDate: number;
  inventoryValue: number;
  inventoryItems: number;
  activeProjects: number;
  planningProjects: number;
  onHoldProjects: number;
};

export type MonthlyAverage = {
  value: number;
  /** Whole months averaged. */
  months: number;
  /** First and last month averaged, "2026-04" and "2026-10". */
  fromMonth: string;
  toMonth: string;
  /** True when the selected period had no whole month yet, so the three months before this one were used. */
  fallback: boolean;
  /** For a custom range that has no whole month: the three months before the range ends were used. */
  beforeRangeEnd?: boolean;
};

/** One bar group of the income and expense trend: a month, a financial quarter or a financial year. */
export type TrendPoint = { key: string; label: string; income: number; expenses: number; profit: number };

export type Trends = { month: TrendPoint[]; quarter: TrendPoint[]; year: TrendPoint[] };

/** Balance sheet and cash figures for admins, from the accounting engine. */
export type PositionFigures = {
  /** The day the balances are taken: the period's last day, or today when the period ends later. */
  asOf: string;
  /** True when asOf is today, so the balances are the current ones. */
  asOfToday: boolean;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  cash: number;
  /** Assets minus liabilities minus equity; 0 when the books balance. */
  difference: number;
  /** Cash and bank movement over the period, transfers between own accounts left out. */
  cashIn: number;
  cashOut: number;
  /** Profit from the profit and loss statement for the same period (accrual basis). */
  plProfit: number;
  /** Query string (from, to) for the statement pages over the same period. */
  statementQuery: string;
};

export type OpenItemsTotals = { total: number; count: number; overdue: number; overdueCount: number; dueSoon: number };

/** Something to pay or to receive: overdue, or due in the next 30 days. */
export type DueItem = {
  id: string;
  /** "due": a liability that is not a loan (TDS, salaries or rent due). */
  kind: "bill" | "loan" | "due" | "recurring" | "invoice";
  title: string;
  /** Vendor, lender or client. */
  party: string;
  /** Due day, yyyy-mm-dd. */
  date: string;
  amount: number;
  overdue: boolean;
  href: string;
};

export type DuePayments = {
  /** The first items of each list, overdue first; the counts and totals cover every item. */
  pay: DueItem[];
  receive: DueItem[];
  payCount: number;
  receiveCount: number;
  payOverdue: number;
  payUpcoming: number;
  receiveOverdue: number;
  receiveUpcoming: number;
  /** True when salary items were left out of the lists (members). */
  salariesHidden: boolean;
};

/** One open project for the project-wise summary table. */
export type ProjectSummaryRow = {
  id: string;
  name: string;
  code: string;
  color: string;
  status: ProjectStatus;
  revenue: number;
  received: number;
  outstanding: number;
  spent: number;
  budget: number;
  /** spent / budget; null without a budget. */
  utilisation: number | null;
  estimatedProfit: number;
};

export type ProjectTotals = {
  /** Open projects: planning, active and on hold. */
  count: number;
  budget: number;
  spent: number;
  utilisation: number | null;
};

export type MonthlyPoint = { month: string; income: number; expenses: number; profit: number };

export type CategoryStack = {
  /** Series keys in stacking order (bottom first), with display labels. */
  series: {
    key: string;
    label: string;
    /** Set for categories admins added: a fixed colour per category. Built-ins take chart colours by rank. */
    color?: { light: string; dark: string };
  }[];
  /** One row per month; each series key holds that month's total. */
  rows: ({ month: string } & Record<string, number | string>)[];
  total: number;
};

export type BudgetRow = {
  id: string;
  name: string;
  code: string;
  color: string;
  status: ProjectStatus;
  budget: number;
  spent: number;
  remaining: number;
  usage: number;
};

export type Transaction = {
  id: string;
  direction: "income" | "expense";
  number: string;
  party: string;
  amount: number;
  date: string;
  /** The stored value: an expense category (built-in or custom) or an income category. */
  category: string;
  /** Its current name, resolved on the server. */
  categoryLabel: string;
  project: { id: string; name: string; color: string } | null;
  href: string;
};

export type RecurringCommitments = {
  /** Sum of monthly equivalents over all active schedules, salaries included for every viewer. */
  perMonth: number;
  /** The part of perMonth that is salaries. */
  salariesPerMonth: number;
  activeCount: number;
  /** The next due items, soonest first; members do not get salary schedules here. */
  upcoming: { id: string; name: string; date: string; amount: number }[];
};

export type FinanceDashboardData = {
  period: DashboardPeriod;
  /** The custom range's days when period is "custom". */
  custom: { from: string; to: string } | null;
  periodLabel: string;
  periodPhrase: string;
  /** First and last day (YYYY-MM-DD, IST) of the selected period; null for all time. */
  periodDates: { from: string; to: string } | null;
  previousPhrase: string | null;
  kpis: DashboardKpis;
  monthly: MonthlyPoint[];
  trends: Trends;
  /** Admins only; null for members. */
  position: PositionFigures | null;
  receivables: OpenItemsTotals;
  payables: OpenItemsTotals;
  projectTotals: ProjectTotals;
  projectSummaries: ProjectSummaryRow[];
  due: DuePayments;
  categories: CategoryStack;
  budgets: BudgetRow[];
  transactions: Transaction[];
  recurring: RecurringCommitments;
  /** True when nothing has been recorded yet (no income, expenses or projects). */
  empty: boolean;
};
