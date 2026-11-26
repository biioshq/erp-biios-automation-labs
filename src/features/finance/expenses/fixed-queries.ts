import "server-only";

import { connectDB } from "@/server/db";
import { Expense, Liability, RecurringExpense } from "@/server/models";
import { iso } from "@/server/serialize";
import { salaryScope } from "@/server/auth/session";
import { liabilityState } from "@/server/finance/summaries";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { addDays, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { monthlyEquivalent, upcomingOccurrences } from "@/lib/recurrence";
import type { RecurringFrequency, RecurringStatus } from "@/lib/constants";
import { emiSchedule } from "@/features/finance/liabilities/schedule";
import { fixedCommitmentFilter } from "@/features/finance/recurring/fixed";
import { lastPostedBySchedule } from "@/features/finance/recurring/queries";
import type { LastPosted } from "@/features/finance/recurring/types";
import { OUTSTANDING_EXPR, statusCondition } from "./payment-status";

/**
 * Fixed payments (/finance/expenses/fixed): what the company is committed to pay, from two sources
 * it already keeps. Loan instalments come from Liabilities (liabilityState and the EMI plan, worked
 * out the way the Loans page does); fixed recurring schedules come from Recurring expenses (the
 * schedule's own flag, or rent by default). Nothing here is stored or written.
 */

/** overdue: a planned instalment (or the due date) has passed unpaid; due: next one within 30 days; upcoming: later. */
export type FixedStatus = "overdue" | "due" | "upcoming";

export type FixedLoanRow = {
  id: string;
  code: string;
  name: string;
  lender: string;
  /** The usual instalment (EMI); null when the loan has none set. */
  installment: number | null;
  /** The next instalment not yet covered by repayments, or the loan's due date when it has no plan. */
  nextDue: string | null;
  nextAmount: number | null;
  /** Principal still owed. */
  outstanding: number;
  status: FixedStatus;
  /** Planned instalments past their date and not covered (or the whole balance past the due date). */
  overdueAmount: number;
  overdueCount: number;
  /** Instalments falling due from today to 30 days ahead. */
  due30Amount: number;
  due30Count: number;
  /** True when the rate, tenure and instalment give a repayment plan. */
  planned: boolean;
};

export type FixedScheduleRow = {
  id: string;
  code: string;
  name: string;
  vendor: string;
  categoryLabel: string;
  amount: number;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  startDate: string;
  nextRunDate: string;
  scheduleStatus: RecurringStatus;
  monthly: number;
  /** Fixed by the schedule's own switch, or by the default rule for rent. */
  byDefault: boolean;
  status: FixedStatus | "paused";
  due30Amount: number;
  due30Count: number;
  lastPosted: LastPosted | null;
};

export type FixedSummary = {
  committedMonthly: number;
  due30Amount: number;
  due30Count: number;
  overdueAmount: number;
  overdueCount: number;
};

export type FixedPayments = {
  loans: FixedLoanRow[] | null;
  schedules: FixedScheduleRow[] | null;
  /** Posted expenses of fixed schedules still owed past their due date (part of the overdue figure). */
  overduePosted: { amount: number; count: number };
  summary: FixedSummary;
};

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

/** Open loans with what they ask for each month, when the next one falls due, and what is late. */
async function fixedLoans(now: Date): Promise<FixedLoanRow[]> {
  const docs = await Liability.find({ archivedAt: null, kind: { $ne: "other" } }).sort({ date: -1 }).lean();
  const today = toDateInput(now);
  const soon = toDateInput(addDays(now, 30));
  const rows: FixedLoanRow[] = [];
  for (const l of docs) {
    const s = liabilityState(l, now);
    if (s.outstanding <= 0) continue;
    const plan = emiSchedule(
      { originalAmount: l.originalAmount, interestRate: l.interestRate ?? null, tenureMonths: l.tenureMonths ?? null, installment: l.installment ?? null, date: toDateInput(l.date) },
      s.principalPaid,
      now,
    );
    const base = { id: String(l._id), code: l.code, name: l.name, lender: l.lender, installment: l.installment ?? null, outstanding: s.outstanding };
    if (plan) {
      const late = plan.rows.filter((r) => r.status === "due");
      const coming = plan.rows.filter((r) => r.status === "upcoming" && r.dueDate >= today && r.dueDate <= soon);
      const next = plan.next;
      rows.push({
        ...base,
        nextDue: next?.dueDate ?? null,
        nextAmount: next?.installment ?? null,
        status: late.length ? "overdue" : next && next.dueDate <= soon ? "due" : "upcoming",
        overdueAmount: sum(late.map((r) => r.installment)),
        overdueCount: late.length,
        due30Amount: sum(coming.map((r) => r.installment)),
        due30Count: coming.length,
        planned: true,
      });
      continue;
    }
    // No plan: the balance is due on the loan's due date, if it has one.
    const due = l.dueDate ? toDateInput(l.dueDate) : null;
    const overdue = s.status === "overdue";
    const dueSoon = !overdue && due !== null && due >= today && due <= soon;
    rows.push({
      ...base,
      nextDue: due,
      nextAmount: due ? s.outstanding : null,
      status: overdue ? "overdue" : dueSoon ? "due" : "upcoming",
      overdueAmount: overdue ? s.outstanding : 0,
      overdueCount: overdue ? 1 : 0,
      due30Amount: dueSoon ? s.outstanding : 0,
      due30Count: dueSoon ? 1 : 0,
      planned: false,
    });
  }
  const order: Record<FixedStatus, number> = { overdue: 0, due: 1, upcoming: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
}

/** Active and paused schedules that are fixed commitments, with the dates due in the next 30 days. */
async function fixedSchedules(now: Date): Promise<{ rows: FixedScheduleRow[]; overduePosted: { amount: number; count: number } }> {
  const scope = await salaryScope();
  const filter = { $and: [fixedCommitmentFilter(), { status: { $in: ["active", "paused"] } }, ...(Object.keys(scope).length ? [scope] : [])] };
  const [docs, labelOf] = await Promise.all([RecurringExpense.find(filter).sort({ nextRunDate: 1 }).lean(), getExpenseCategoryLabeler()]);
  const ids = docs.map((d) => d._id);
  const [last, owed] = await Promise.all([
    lastPostedBySchedule(ids, now),
    // Expenses these schedules posted that are still owed past their due date (status as the Expenses list counts it).
    ids.length
      ? Expense.aggregate<{ amount: number; count: number }>([
          { $match: { $and: [{ recurring: { $in: ids } }, statusCondition(["overdue"], now)] } },
          { $group: { _id: null, amount: { $sum: OUTSTANDING_EXPR }, count: { $sum: 1 } } },
        ])
      : Promise.resolve([]),
  ]);
  const horizon = addDays(startOfDayIST(now), 30);
  const today = startOfDayIST(now);
  const rows = docs.map((t): FixedScheduleRow => {
    const frequency = t.frequency as RecurringFrequency;
    const active = t.status === "active";
    // Dates the scheduler still has to post up to 30 days ahead; overdue ones post on its next run.
    const dates = active ? upcomingOccurrences(t.nextRunDate, frequency, t.dayOfMonth ?? 1, 36, t.endDate).filter((d) => d.getTime() <= horizon.getTime()) : [];
    const lastPosted = last.get(String(t._id)) ?? null;
    const lastLate = lastPosted?.status === "overdue";
    return {
      id: String(t._id),
      code: t.code,
      name: t.name,
      vendor: t.vendor,
      categoryLabel: labelOf(t.category),
      amount: t.amount,
      frequency,
      dayOfMonth: t.dayOfMonth ?? 1,
      startDate: iso(t.startDate)!,
      nextRunDate: iso(t.nextRunDate)!,
      scheduleStatus: t.status as RecurringStatus,
      monthly: round2(monthlyEquivalent(t.amount, frequency)),
      byDefault: typeof t.fixed !== "boolean",
      status: !active ? "paused" : lastLate ? "overdue" : t.nextRunDate.getTime() < today.getTime() || dates.length ? "due" : "upcoming",
      due30Amount: round2(dates.length * t.amount),
      due30Count: dates.length,
      lastPosted,
    };
  });
  return { rows, overduePosted: { amount: round2(owed[0]?.amount ?? 0), count: owed[0]?.count ?? 0 } };
}

/**
 * The sections the person may see: loans with Liabilities view, schedules with Recurring view. The
 * header figures add up only what is shown.
 */
export async function getFixedPayments(access: { loans: boolean; schedules: boolean }, now: Date = new Date()): Promise<FixedPayments> {
  await connectDB();
  const [loans, sched] = await Promise.all([
    access.loans ? fixedLoans(now) : Promise.resolve(null),
    access.schedules ? fixedSchedules(now) : Promise.resolve(null),
  ]);
  const schedules = sched?.rows ?? null;
  const overduePosted = sched?.overduePosted ?? { amount: 0, count: 0 };
  const activeSchedules = (schedules ?? []).filter((s) => s.scheduleStatus === "active");
  const summary: FixedSummary = {
    committedMonthly: sum([...(loans ?? []).map((l) => l.installment ?? 0), ...activeSchedules.map((s) => s.monthly)]),
    due30Amount: sum([...(loans ?? []).map((l) => l.due30Amount), ...activeSchedules.map((s) => s.due30Amount)]),
    due30Count: (loans ?? []).reduce((n, l) => n + l.due30Count, 0) + activeSchedules.reduce((n, s) => n + s.due30Count, 0),
    overdueAmount: sum([...(loans ?? []).map((l) => l.overdueAmount), overduePosted.amount]),
    overdueCount: (loans ?? []).reduce((n, l) => n + l.overdueCount, 0) + overduePosted.count,
  };
  return { loans, schedules, overduePosted, summary };
}
