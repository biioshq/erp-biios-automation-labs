import type { ExpenseCategory, ProjectStatus } from "@/lib/constants";
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
  /** Calendar month spending, independent of the selected period. */
  monthSpend: number;
  /** This month up to today against the same days of last month (1st to today's date). */
  monthSpendDelta: number | null;
  inventoryValue: number;
  inventoryItems: number;
  activeProjects: number;
  planningProjects: number;
  onHoldProjects: number;
};

export type MonthlyPoint = { month: string; income: number; expenses: number; profit: number };

export type CategoryStack = {
  /** Series keys in stacking order (bottom first), with display labels. */
  series: { key: string; label: string }[];
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
  category: ExpenseCategory | string;
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
