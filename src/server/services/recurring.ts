import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, RecurringExpense, type RecurringExpenseDoc } from "@/server/models";
import { isDuplicateKeyError } from "@/server/errors";
import { nextNumber } from "@/server/services/numbering";
import { createNotification } from "@/server/services/notifications";
import { startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { isInterState, splitGst } from "@/lib/gst";
import { nextOccurrence, periodLabel } from "@/lib/recurrence";
import type { RecurringFrequency } from "@/lib/constants";
import { auditSafely } from "@/server/audit";
import { expenseCreated } from "@/features/finance/audit/records";

/**
 * Posts due recurring expenses (salaries, rent, bills, subscriptions).
 *
 * Each occurrence is claimed by advancing `nextRunDate` with a conditional
 * update (only one runner can win it), then posted as an expense carrying the
 * unique key "<schedule>:<yyyy-mm-dd>". So a schedule never posts the same date
 * twice, even with several servers or an overlapping manual run, and dates
 * missed while the server was down are caught up in order.
 */

const MAX_CATCH_UP = 36;

export const occurrenceKey = (scheduleId: Types.ObjectId | string, due: Date) => `${scheduleId}:${toDateInput(due)}`;

async function postOccurrence(t: RecurringExpenseDoc, due: Date) {
  const rate = t.gstRate ?? 0;
  const amount = round2(t.amount);
  const interState = isInterState(t.gstin);
  // The amount includes GST and is fixed, so rounding is absorbed by the taxable value. Within the state CGST and
  // SGST are always equal halves (rate / 2 each); across states the IGST absorbs the last paisa instead.
  let taxable = rate > 0 ? round2(amount / (1 + rate / 100)) : amount;
  const split = rate > 0 ? splitGst(taxable, rate, interState) : null;
  if (split && !interState) {
    split.cgst = split.sgst = round2((taxable * rate) / 200);
    taxable = round2(amount - split.cgst - split.sgst);
  }
  const gst = split
    ? (() => {
        const drift = round2(amount - (taxable + split.cgst + split.sgst + split.igst));
        const fixed = { ...split };
        let taxableAmount = taxable;
        if (drift !== 0) {
          if (fixed.igst) fixed.igst = round2(fixed.igst + drift);
          else taxableAmount = round2(taxableAmount + drift);
        }
        return {
          gstin: t.gstin || undefined,
          invoiceDate: due,
          taxableAmount,
          ...fixed,
          cess: 0,
          hsnSac: t.hsnSac || undefined,
          grandTotal: amount,
        };
      })()
    : undefined;

  return Expense.create({
    number: await nextNumber("expense", undefined, due),
    vendor: t.vendor,
    category: t.category,
    description: `${t.name} · ${periodLabel(due, t.frequency as RecurringFrequency)}`,
    amount,
    date: due,
    paymentMethod: t.paymentMethod ?? "bank_transfer",
    project: t.project ?? undefined,
    stage: t.project ? (t.stage ?? undefined) : undefined,
    notes: t.notes ?? undefined,
    gst,
    source: "recurring",
    recurring: t._id,
    occurrenceKey: occurrenceKey(t._id, due),
    employee: t.employee ?? undefined,
    createdBy: t.createdBy ?? undefined,
  });
}

/**
 * Claims and posts one occurrence of a schedule: the one due on `t.nextRunDate`.
 * Returns the posted expense id, or null when another runner got there first.
 */
async function claimAndPost(t: RecurringExpenseDoc): Promise<{ expenseId: string | null; schedule: RecurringExpenseDoc | null }> {
  const due = t.nextRunDate;
  const next = nextOccurrence(due, t.frequency as RecurringFrequency, t.dayOfMonth ?? 1);
  const ended = Boolean(t.endDate && next.getTime() > new Date(t.endDate).getTime());
  const claimed = await RecurringExpense.findOneAndUpdate(
    { _id: t._id, nextRunDate: due, status: "active" },
    { $set: { nextRunDate: next, lastRunDate: due, ...(ended ? { status: "ended" } : {}) }, $inc: { occurrences: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) return { expenseId: null, schedule: null };
  try {
    const expense = await postOccurrence(t, due);
    // The audit trail: by the person who pressed Post now, else by the schedule itself.
    await auditSafely(() => expenseCreated(expense.toObject(), { source: "recurring", ref: { schedule: String(t._id) }, note: `Posted by schedule ${t.name}` }));
    return { expenseId: String(expense._id), schedule: claimed };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { expenseId: null, schedule: claimed };
    // Give the date back so the next run retries it.
    await RecurringExpense.updateOne(
      { _id: t._id, nextRunDate: next },
      { $set: { nextRunDate: due, lastRunDate: t.lastRunDate ?? null, status: "active" }, $inc: { occurrences: -1 } },
    );
    throw error;
  }
}

/** Posts every occurrence due up to today (IST). Safe to call often and from several places. */
export async function postDueRecurringExpenses(now: Date = new Date()): Promise<{ posted: number; schedules: number; failed: number }> {
  await connectDB();
  const today = startOfDayIST(now);
  const due = await RecurringExpense.find({ status: "active", nextRunDate: { $lte: today } }).lean();
  let posted = 0;
  let failed = 0;
  for (const schedule of due) {
    let current: RecurringExpenseDoc | null = schedule;
    for (let i = 0; i < MAX_CATCH_UP && current && current.status === "active" && current.nextRunDate.getTime() <= today.getTime(); i++) {
      if (current.endDate && current.nextRunDate.getTime() > new Date(current.endDate).getTime()) {
        await RecurringExpense.updateOne({ _id: current._id }, { $set: { status: "ended" } });
        break;
      }
      try {
        const result = await claimAndPost(current);
        if (result.expenseId) posted++;
        current = result.schedule;
      } catch (error) {
        failed++;
        console.error(`[recurring] could not post ${schedule.code}`, error);
        break;
      }
    }
  }
  if (posted > 0) {
    // Open pages (expenses, dashboard, projects) refresh to show the new postings.
    const { bumpChanges } = await import("@/server/changes");
    await bumpChanges();
    await createNotification({
      type: "system",
      severity: "info",
      title: `${posted} recurring expense${posted === 1 ? "" : "s"} posted`,
      body: "Salaries and bills due today were added to Expenses.",
      href: "/finance/expenses?source=recurring",
    }).catch(() => {});
  }
  return { posted, schedules: due.length, failed };
}

/** Posts a schedule's next occurrence now, even before its due date (for example, paying salary early). */
export async function postNextOccurrenceNow(scheduleId: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(scheduleId)) return null;
  const t = await RecurringExpense.findById(scheduleId).lean();
  if (!t || t.status !== "active") return null;
  const result = await claimAndPost(t);
  return result.expenseId;
}
