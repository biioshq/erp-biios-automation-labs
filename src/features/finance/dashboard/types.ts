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
  periodLabel: string;
  periodPhrase: string;
  /** First and last day (YYYY-MM-DD, IST) of the selected period; null for all time. */
  periodDates: { from: string; to: string } | null;
  previousPhrase: string | null;
  kpis: DashboardKpis;
  monthly: MonthlyPoint[];
  categories: CategoryStack;
  budgets: BudgetRow[];
  transactions: Transaction[];
  recurring: RecurringCommitments;
  /** True when nothing has been recorded yet (no income, expenses or projects). */
  empty: boolean;
};
