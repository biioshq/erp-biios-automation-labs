"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Expense, RecurringExpense } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { occurrenceKey, postNextOccurrenceNow } from "@/server/services/recurring";
import { getCurrentUser } from "@/server/auth/session";
import { addDays, fromDateInput, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { iso } from "@/server/serialize";
import { round2 } from "@/lib/format";
import { firstOccurrence, nextOccurrence } from "@/lib/recurrence";
import type { RecurringFrequency } from "@/lib/constants";
import { recurringFormSchema, recurringIdSchema, recurringStatusSchema, type RecurringFormValues } from "./schemas";
import { getRecurring } from "./queries";
import type { PostedResult, RecurringDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];
const MAX_STEPS = 1500;

function toDocument(v: RecurringFormValues) {
  const taxed = v.gstRate > 0;
  return {
    name: v.name,
    vendor: v.vendor,
    category: v.category,
    description: v.description,
    amount: round2(v.amount),
    gstRate: v.gstRate,
    gstin: taxed ? v.gstin : undefined,
    hsnSac: taxed ? v.hsnSac : undefined,
    paymentMethod: v.paymentMethod,
    project: v.projectId ? new Types.ObjectId(v.projectId) : undefined,
    stage: v.projectId ? v.stage : undefined,
    employee: v.employeeId ? new Types.ObjectId(v.employeeId) : undefined,
    frequency: v.frequency,
    // Weekly schedules follow the start date's weekday, so the day of month does not apply.
    dayOfMonth: v.frequency === "weekly" ? 1 : v.dayOfMonth,
    startDate: fromDateInput(v.startDate),
    endDate: v.endDate ? fromDateInput(v.endDate) : null,
    notes: v.notes,
  };
}

/**
 * The first due date on or after `from` that has not been posted yet. Steps along the schedule's own
 * rhythm from its start date, so quarterly and yearly schedules keep their original months.
 */
async function firstUnposted(
  scheduleId: Types.ObjectId | null,
  schedule: { startDate: Date; frequency: RecurringFrequency; dayOfMonth: number },
  from: Date,
): Promise<Date> {
  let candidate = firstOccurrence(schedule.startDate, schedule.frequency, schedule.dayOfMonth);
  for (let i = 0; i < MAX_STEPS && candidate.getTime() < from.getTime(); i++) {
    candidate = nextOccurrence(candidate, schedule.frequency, schedule.dayOfMonth);
  }
  if (!scheduleId) return candidate;
  const keys = new Set(
    (await Expense.find({ recurring: scheduleId, date: { $gte: candidate } }, { occurrenceKey: 1 }).lean()).map((e) => e.occurrenceKey),
  );
  for (let i = 0; i < 60 && keys.has(occurrenceKey(scheduleId, candidate)); i++) {
    candidate = nextOccurrence(candidate, schedule.frequency, schedule.dayOfMonth);
  }
  return candidate;
}

/** One live salary schedule per person, so a salary is never booked twice a month. */
async function assertOneSalarySchedule(
  doc: { category?: string | null; employee?: Types.ObjectId | null },
  selfId?: Types.ObjectId,
  statuses: ("active" | "paused")[] = ["active", "paused"],
) {
  if (doc.category !== "salaries" || !doc.employee) return;
  const other = await RecurringExpense.findOne(
    { employee: doc.employee, category: "salaries", status: { $in: statuses }, ...(selfId ? { _id: { $ne: selfId } } : {}) },
    { code: 1 },
  ).lean();
  if (other) {
    throw new AppError(`This person already has a salary schedule (${other.code}). Change that one, or end it first.`, "conflict", {
      employeeId: ["Already has a salary schedule"],
    });
  }
}

const endedBeforeNext = () =>
  new AppError("The end date is before the next due date. Move the end date later, or end the schedule instead.", "invalid", {
    endDate: ["Must be on or after the next due date"],
  });

export const createRecurring = defineAction(
  recurringFormSchema,
  async (input, user) => {
    const doc = toDocument(input);
    const nextRunDate = firstOccurrence(doc.startDate, doc.frequency, doc.dayOfMonth);
    if (doc.endDate && nextRunDate.getTime() > doc.endDate.getTime()) throw endedBeforeNext();
    await assertOneSalarySchedule(doc);
    const code = await nextNumber("recurring");
    const created = await RecurringExpense.create({
      ...doc,
      code,
      nextRunDate,
      occurrences: 0,
      status: "active",
      createdBy: new Types.ObjectId(user.id),
    });
    return { id: String(created._id), code };
  },
  { revalidate: REVALIDATE, message: "Schedule created", role: "admin" },
);

export const updateRecurring = defineAction(
  recurringFormSchema.and(recurringIdSchema),
  async (input) => {
    const existing = await RecurringExpense.findById(input.id).lean();
    if (!existing) throw notFound("The schedule");
    const doc = toDocument(input);
    if (existing.status !== "ended") await assertOneSalarySchedule(doc, existing._id);

    const rhythmChanged =
      doc.frequency !== existing.frequency ||
      doc.dayOfMonth !== (existing.dayOfMonth ?? 1) ||
      toDateInput(doc.startDate) !== toDateInput(existing.startDate);

    let nextRunDate = existing.nextRunDate;
    if (existing.status !== "ended") {
      if (rhythmChanged) {
        // Never re-post past dates: continue from today (or the start date), skipping anything already posted.
        const today = startOfDayIST();
        const from = new Date(Math.max(today.getTime(), doc.startDate.getTime()));
        // Never post the period that was already paid either. Monthly and longer schedules post one expense per month
        // ("Nov 2026"), so a new day of month starts in the month after the last posted one, not on the next day.
        // Weekly posts cover a week, so the next day is enough.
        const afterLast = existing.lastRunDate
          ? existing.frequency === "weekly"
            ? addDays(existing.lastRunDate, 1)
            : startOfMonthIST(existing.lastRunDate, 1)
          : null;
        nextRunDate = await firstUnposted(existing._id, doc, afterLast && afterLast.getTime() > from.getTime() ? afterLast : from);
      }
      if (doc.endDate && nextRunDate.getTime() > doc.endDate.getTime()) throw endedBeforeNext();
    }

    const set: Record<string, unknown> = { nextRunDate };
    const unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (value === undefined) unset[key] = 1;
      else set[key] = value;
    }
    await RecurringExpense.updateOne({ _id: existing._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Schedule updated", role: "admin" },
);

/** Pause, resume or end a schedule. Ending is final. */
export const setRecurringStatus = defineAction(
  recurringStatusSchema,
  async ({ id, action }) => {
    const existing = await RecurringExpense.findById(id).lean();
    if (!existing) throw notFound("The schedule");
    const wrongState = () => new AppError("This schedule changed in the meantime. Reload and try again.", "conflict");

    if (action === "pause") {
      const res = await RecurringExpense.updateOne({ _id: existing._id, status: "active" }, { $set: { status: "paused" } });
      if (!res.matchedCount) throw wrongState();
      return { id, status: "paused" as const };
    }
    if (action === "end") {
      const res = await RecurringExpense.updateOne({ _id: existing._id, status: { $in: ["active", "paused"] } }, { $set: { status: "ended" } });
      if (!res.matchedCount) throw wrongState();
      return { id, status: "ended" as const };
    }
    // Resume: dates missed while paused are skipped, not posted in a burst.
    if (existing.status !== "paused") throw wrongState();
    // A paused duplicate (or every schedule paused when pay was switched off) must not come back next to the one
    // that already pays this person, or two salaries post each month.
    await assertOneSalarySchedule(existing, existing._id);
    let nextRunDate = existing.nextRunDate;
    const today = startOfDayIST();
    if (nextRunDate.getTime() < today.getTime()) {
      nextRunDate = await firstUnposted(
        existing._id,
        { startDate: existing.startDate, frequency: existing.frequency as RecurringFrequency, dayOfMonth: existing.dayOfMonth ?? 1 },
        today,
      );
    }
    if (existing.endDate && nextRunDate.getTime() > existing.endDate.getTime()) {
      throw new AppError("This schedule's end date has passed. Edit the end date to resume it.", "invalid");
    }
    const res = await RecurringExpense.updateOne({ _id: existing._id, status: "paused" }, { $set: { status: "active", nextRunDate } });
    if (!res.matchedCount) throw wrongState();
    return { id, status: "active" as const };
  },
  { revalidate: REVALIDATE, message: "Schedule updated", role: "admin" },
);

/** Posts the next occurrence now, even before its due date. */
export const postRecurringNow = defineAction(
  recurringIdSchema,
  async ({ id }): Promise<PostedResult> => {
    const existing = await RecurringExpense.findById(id).lean();
    if (!existing) throw notFound("The schedule");
    if (existing.status !== "active") throw new AppError("Only an active schedule can post. Resume it first.", "conflict");
    // A second active salary schedule for the same person (made before duplicates were refused) would pay them twice.
    // A paused or ended one does not block this.
    await assertOneSalarySchedule(existing, existing._id, ["active"]);
    const expenseId = await postNextOccurrenceNow(id);
    if (!expenseId) throw new AppError("That date was already posted by another run. Reload to see the latest.", "conflict");
    const expense = await Expense.findById(expenseId, { number: 1, date: 1, amount: 1 }).lean();
    return { expenseId, number: expense?.number ?? "", date: iso(expense?.date) ?? iso(existing.nextRunDate)!, amount: expense?.amount ?? existing.amount };
  },
  { revalidate: REVALIDATE, message: "Expense posted", role: "admin" },
);

/** Only a schedule that never posted can be deleted. Otherwise end it, and the history stays. */
export const deleteRecurring = defineAction(
  recurringIdSchema,
  async ({ id }) => {
    const existing = await RecurringExpense.findById(id).lean();
    if (!existing) throw notFound("The schedule");
    const posted = await Expense.exists({ recurring: existing._id });
    if (posted || (existing.occurrences ?? 0) > 0) {
      throw new AppError("This schedule has posted expenses. End it instead, and its history stays in Expenses.", "conflict");
    }
    await RecurringExpense.deleteOne({ _id: existing._id });
    return { id };
  },
  { revalidate: REVALIDATE, message: "Schedule deleted", role: "admin" },
);

/** Loads one schedule for the detail drawer / edit form. */
export async function fetchRecurring(id: string): Promise<RecurringDetail | null> {
  if (!(await getCurrentUser())) return null;
  return getRecurring(id);
}
