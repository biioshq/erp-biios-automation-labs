import "server-only";

import { connectDB } from "@/server/db";
import { Liability } from "@/server/models";
import { liabilityState } from "@/server/finance/summaries";
import { addDays, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { emiSchedule } from "@/features/finance/liabilities/schedule";

/**
 * Loan and borrowing instalments (EMIs) for the Recurring expenses page: what each open loan asks
 * for every month, when the next one falls due and what is late. Worked out from Liabilities the
 * way the Loans page does (liabilityState and the EMI plan). Nothing is stored or written: a
 * repayment is recorded on the loan, which books its interest part as an expense.
 */

/** overdue: a planned instalment (or the due date) has passed unpaid; due: next one within 30 days; upcoming: later. */
export type InstalmentStatus = "overdue" | "due" | "upcoming";

export type LoanInstalmentRow = {
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
  status: InstalmentStatus;
  /** Planned instalments past their date and not covered (or the whole balance past the due date). */
  overdueAmount: number;
  overdueCount: number;
  /** Instalments falling due from today to 30 days ahead. */
  due30Amount: number;
  due30Count: number;
  /** True when the rate, tenure and instalment give a repayment plan. */
  planned: boolean;
};

export type LoanInstalments = {
  rows: LoanInstalmentRow[];
  /** The instalments of open loans added up: what the loans ask for each month. */
  monthly: number;
  /** Open loans with an instalment set (the ones counted in `monthly`). */
  withInstalment: number;
  due30Amount: number;
  due30Count: number;
  overdueAmount: number;
  overdueCount: number;
};

const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));

/** Open loans with a balance, overdue first, then by the next due date. */
export async function getLoanInstalments(now: Date = new Date()): Promise<LoanInstalments> {
  await connectDB();
  const docs = await Liability.find({ archivedAt: null, kind: { $ne: "other" } }).sort({ date: -1 }).lean();
  const today = toDateInput(now);
  const soon = toDateInput(addDays(now, 30));
  const rows: LoanInstalmentRow[] = [];
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
  const order: Record<InstalmentStatus, number> = { overdue: 0, due: 1, upcoming: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.nextDue ?? "9999").localeCompare(b.nextDue ?? "9999"));
  const withInstalment = rows.filter((r) => (r.installment ?? 0) > 0);
  return {
    rows,
    monthly: sum(withInstalment.map((r) => r.installment ?? 0)),
    withInstalment: withInstalment.length,
    due30Amount: sum(rows.map((r) => r.due30Amount)),
    due30Count: rows.reduce((n, r) => n + r.due30Count, 0),
    overdueAmount: sum(rows.map((r) => r.overdueAmount)),
    overdueCount: rows.reduce((n, r) => n + r.overdueCount, 0),
  };
}
