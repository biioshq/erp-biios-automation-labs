import type { PaymentMethod, ProjectStage, RecurringFrequency, RecurringStatus } from "@/lib/constants";

/** A row in the recurring expenses table. */
export type RecurringRow = {
  id: string;
  code: string;
  name: string;
  vendor: string;
  /** The stored value: a built-in (EXPENSE_CATEGORIES) or a custom category. */
  category: string;
  /** Its current name, resolved on the server. */
  categoryLabel: string;
  /** Per occurrence, GST included. */
  amount: number;
  gstRate: number;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  status: RecurringStatus;
  /** Expenses posted so far. */
  occurrences: number;
  /** Cost per month: amount spread over the rhythm. */
  monthly: number;
  project: { id: string; name: string; code: string; color: string } | null;
  stage: ProjectStage | null;
  employee: { id: string; name: string } | null;
};

export type PostedExpense = { id: string; number: string; date: string; amount: number };

/** Everything the detail drawer and the edit form need. */
export type RecurringDetail = RecurringRow & {
  description: string | null;
  gstin: string | null;
  hsnSac: string | null;
  paymentMethod: PaymentMethod;
  notes: string | null;
  /** The next 6 due dates (ISO), starting at nextRunDate. Empty unless active or paused. */
  upcoming: string[];
  /** Newest first. */
  posted: PostedExpense[];
  postedTotal: number;
  postedCount: number;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type RecurringSummary = {
  /** Sum of monthly equivalents over active schedules. */
  committedMonthly: number;
  salariesMonthly: number;
  /** Occurrences due from today up to 30 days ahead, plus any overdue ones waiting to post. */
  dueCount: number;
  dueAmount: number;
  pausedCount: number;
  activeCount: number;
  /** Tab counts by group value. */
  groupCounts: Record<string, number>;
  total: number;
};

export type PostedResult = { expenseId: string; number: string; date: string; amount: number };
