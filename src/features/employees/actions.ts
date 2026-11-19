"use server";

import { Types, type QueryFilter } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, isDuplicateKeyError, notFound } from "@/server/errors";
import { Employee, Expense, ProjectMember, RecurringExpense, User, type EmployeeDoc, type RecurringExpenseDoc } from "@/server/models";
import { getCurrentUser } from "@/server/auth/session";
import { nextNumber } from "@/server/services/numbering";
import { fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { firstOccurrence, nextOccurrence } from "@/lib/recurrence";
import type { RecurringFrequency } from "@/lib/constants";
import { employeeFormSchema, employeeIdSchema, type EmployeeFormValues } from "./schemas";
import { getEmployee, linkedSalarySchedule, primarySalarySchedule, salarySchedulesFor } from "./queries";
import type { EmployeeDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/** Salary is paid on the last day of each month. */
const SALARY_DAY = 31;

/** True when two dates fall on the same IST day. */
function sameDay(a?: Date | null, b?: Date | null): boolean {
  return Boolean(a && b && toDateInput(a) === toDateInput(b));
}

/** A schedule's first due date on or after `from`, in its own rhythm (as resuming it on the Recurring page counts). */
function firstPaydayFrom(s: Pick<RecurringExpenseDoc, "startDate" | "frequency" | "dayOfMonth">, from: Date): Date {
  const frequency = s.frequency as RecurringFrequency;
  const day = s.dayOfMonth ?? 1;
  let due = firstOccurrence(s.startDate, frequency, day);
  for (let i = 0; i < 1000 && due.getTime() < from.getTime(); i++) due = nextOccurrence(due, frequency, day);
  return due;
}

/**
 * Keeps the employee's salary schedule (a monthly recurring expense) in step with the employee:
 * created when salary payment is switched on, amount follows the salary, paused when switched off,
 * ended when the employee exits. A salaries schedule made for them on the Recurring page is adopted
 * rather than doubled. Returns the schedule id to store on the employee, if any.
 */
async function syncSalarySchedule(
  employee: Pick<EmployeeDoc, "_id" | "salaryRecurring" | "status" | "exitDate">,
  opts: { name: string; status: string; joinDate?: Date; exitDate?: Date; monthlySalary: number; pay: boolean; userId: string; canChangePay: boolean },
): Promise<Types.ObjectId | undefined> {
  const schedules = await salarySchedulesFor(employee._id, employee.salaryRecurring);
  const today = startOfDayIST();
  const name = `Salary: ${opts.name}`;

  // The payee follows the employee's name, whoever renames them: no pay changes, and every later salary is posted
  // under the schedule's vendor, so a stale name would hide it from searches by the new one.
  const renamed = schedules.filter((s) => s.name !== name || s.vendor !== opts.name).map((s) => s._id);
  if (renamed.length) await RecurringExpense.updateMany({ _id: { $in: renamed } }, { $set: { name, vendor: opts.name } });

  // Undoing or moving an exit, whoever records it: the end date that exit put on the schedule comes off again, so
  // pay continues (or follows the new date below). This only puts back what the exit changed, so it is not a pay
  // change. Without it, a member who undoes a future exit leaves the salary ending on the old date, and nothing
  // later shows why. Undoing an exit already past stays final: an admin restarts pay by saving with "Pay salary" on.
  // Moving a past exit to today or later brings the person back until the new date, as their memberships come
  // back (see syncMemberships), but their schedule comes back paused, for an admin to resume on the Recurring page:
  // a past exit ended a paused schedule the same way as one it stopped paying, so turning it on could restart pay
  // an admin had switched off.
  const oldExit = employee.status === "exited" ? employee.exitDate : null;
  const newExit = opts.status === "exited" ? (opts.exitDate ?? today) : null;
  if (oldExit && !(newExit && sameDay(newExit, oldExit))) {
    const primary = primarySalarySchedule(schedules);
    for (const s of schedules) {
      if (!sameDay(s.endDate, oldExit)) continue;
      if (s.status === "ended") {
        if (s !== primary) continue;
        if (oldExit.getTime() >= today.getTime()) {
          // A notice-period schedule ends itself after the last payday before the exit, so it may already be ended
          // while the exit is still ahead. Bring the employee's own one back, never with missed dates to catch up.
          if (s.nextRunDate.getTime() < today.getTime()) continue;
          s.status = "active";
        } else {
          // Only when a payday is still owed before the new exit: otherwise it stays ended, as it would be anyway.
          if (!newExit || newExit.getTime() < today.getTime() || firstPaydayFrom(s, today).getTime() > newExit.getTime()) continue;
          s.status = "paused";
        }
      }
      s.endDate = null;
      await RecurringExpense.updateOne({ _id: s._id }, { $set: { status: s.status, endDate: null } });
    }
  }

  const live = schedules.filter((s) => s.status !== "ended");
  const existing = primarySalarySchedule(schedules);

  if (opts.status === "exited") {
    // Leaving ends every salary schedule of theirs, whoever records it. Salary due up to a future exit date
    // (a notice period) still posts: the schedule only gets the end date and ends itself after the last one.
    // A paused schedule waits for a future exit with only the end date too: it cannot post either way, and ending
    // it would let undoing the exit (above) bring it back as active, turning pay on that an admin had switched off.
    const exitDate = opts.exitDate ?? today;
    const exitAhead = exitDate.getTime() >= today.getTime();
    for (const s of live) {
      const stillOwed = s.status === "active" ? s.nextRunDate.getTime() <= exitDate.getTime() : exitAhead;
      await RecurringExpense.updateOne({ _id: s._id }, { $set: stillOwed ? { endDate: exitDate } : { status: "ended", endDate: exitDate } });
    }
    return existing?._id;
  }
  if (!opts.canChangePay) return existing?._id;

  // One salary schedule per person: an older duplicate (made before duplicates were refused) would post a second
  // salary. It is ended, not paused, so resuming it on the Recurring page cannot bring the second salary back.
  const others = live.filter((s) => s !== existing).map((s) => s._id);
  if (others.length) await RecurringExpense.updateMany({ _id: { $in: others } }, { $set: { status: "ended" } });

  const wants = opts.pay && opts.monthlySalary > 0;

  if (!wants) {
    // Switching pay off stops the schedule that pays them.
    if (existing?.status === "active") await RecurringExpense.updateOne({ _id: existing._id }, { $set: { status: "paused" } });
    return existing?._id;
  }

  const amount = round2(opts.monthlySalary);
  if (existing) {
    const set: Record<string, unknown> = { amount, employee: employee._id };
    if (existing.status !== "active") {
      // Coming back from paused or ended: start again from today, never catch up on missed months.
      const start = opts.joinDate && opts.joinDate > today ? opts.joinDate : today;
      set.status = "active";
      set.endDate = null;
      set.startDate = start;
      set.nextRunDate = firstOccurrence(start, "monthly", SALARY_DAY);
    }
    await RecurringExpense.updateOne({ _id: existing._id }, { $set: set });
    return existing._id;
  }

  const start = opts.joinDate && opts.joinDate > today ? opts.joinDate : today;
  const created = await RecurringExpense.create({
    code: await nextNumber("recurring"),
    name,
    vendor: opts.name,
    category: "salaries",
    description: "Monthly salary",
    amount,
    gstRate: 0,
    paymentMethod: "bank_transfer",
    employee: employee._id,
    frequency: "monthly",
    dayOfMonth: SALARY_DAY,
    startDate: start,
    nextRunDate: firstOccurrence(start, "monthly", SALARY_DAY),
    status: "active",
    createdBy: new Types.ObjectId(opts.userId),
  });
  return created._id;
}

async function assertUnique(input: EmployeeFormValues, selfId?: string) {
  if (input.email) {
    const clash = await Employee.findOne({ email: input.email, ...(selfId ? { _id: { $ne: selfId } } : {}) }, { _id: 1 }).lean();
    if (clash) throw new AppError("Another employee already uses this email.", "conflict", { email: ["Already in use"] });
  }
  if (input.userId) {
    const user = await User.exists({ _id: input.userId });
    if (!user) throw new AppError("That sign-in account no longer exists.", "not_found", { userId: ["Account not found"] });
    const clash = await Employee.findOne({ user: input.userId, ...(selfId ? { _id: { $ne: selfId } } : {}) }, { name: 1 }).lean();
    if (clash) {
      throw new AppError(`That account is already linked to ${clash.name}.`, "conflict", { userId: ["Already linked to someone else"] });
    }
  }
}

/** Fields stored on the employee from the form (salary is added separately for admins). */
function baseFields(v: EmployeeFormValues) {
  const exited = v.status === "exited";
  return {
    name: v.name,
    email: v.email,
    phone: v.phone,
    designation: v.designation,
    department: v.department,
    employmentType: v.employmentType,
    status: v.status,
    joinDate: v.joinDate ? fromDateInput(v.joinDate) : undefined,
    exitDate: exited ? fromDateInput(v.exitDate ?? toDateInput(new Date())) : undefined,
    skills: v.skills,
    notes: v.notes,
    user: v.userId ? new Types.ObjectId(v.userId) : undefined,
  };
}

/**
 * Ending a person's time at the company ends their project memberships on the exit date. A future exit keeps them
 * on their teams until that day (a membership is current until its end date, see ./membership), as their salary
 * keeps posting until it. When the exit is moved or undone, the memberships it ended move or reopen with it, so
 * a corrected exit does not leave the person off every team.
 */
async function syncMemberships(employeeId: Types.ObjectId, oldExit: Date | null | undefined, newExit: Date | undefined) {
  const today = startOfDayIST();
  // Undoing an exit already past is a return, not a correction: their old teams stay in the history.
  if (oldExit && !sameDay(oldExit, newExit) && (newExit || oldExit.getTime() >= today.getTime())) {
    // The rows that exit ended: their end is the exit date, or the start date for one that started after it.
    // (Filtered here: Mongoose casts a date inside $expr to a number, which never matches.)
    const endedBy = (m: { startDate?: Date | null; endDate?: Date | null }) =>
      m.endDate?.getTime() === Math.max(oldExit.getTime(), m.startDate?.getTime() ?? 0);
    const ended = (await ProjectMember.find({ employee: employeeId, endDate: { $gte: oldExit } }, { startDate: 1, endDate: 1 }).lean()).filter(endedBy);
    for (const m of ended) {
      const endDate = newExit ? new Date(Math.max(newExit.getTime(), m.startDate?.getTime() ?? 0)) : null;
      try {
        await ProjectMember.updateOne({ _id: m._id }, { $set: { endDate } });
      } catch (error) {
        // They were added to that project again since: the newer membership stays the open one.
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
  }
  if (newExit) {
    // Open memberships, and any planned to end after the exit, end on the exit date.
    const after = new Date(Math.max(newExit.getTime(), today.getTime()));
    await ProjectMember.updateMany(
      { employee: employeeId, $or: [{ endDate: null }, { endDate: { $gt: after } }] },
      [{ $set: { endDate: { $max: ["$startDate", newExit] } } }],
      { updatePipeline: true },
    );
  }
}

export const createEmployee = defineAction(
  employeeFormSchema,
  async (input, user) => {
    await assertUnique(input);
    const isAdmin = user.role === "admin";
    const fields = baseFields(input);
    const code = await nextNumber("employee");
    const created = await Employee.create({
      ...fields,
      code,
      monthlySalary: isAdmin ? round2(input.monthlySalary ?? 0) : 0,
      createdBy: new Types.ObjectId(user.id),
    });
    const scheduleId = await syncSalarySchedule(created, {
      name: input.name,
      status: input.status,
      joinDate: fields.joinDate,
      exitDate: fields.exitDate,
      monthlySalary: input.monthlySalary ?? 0,
      pay: Boolean(input.paySalary),
      userId: user.id,
      canChangePay: isAdmin,
    });
    if (scheduleId) await Employee.updateOne({ _id: created._id }, { $set: { salaryRecurring: scheduleId } });
    if (fields.exitDate) await syncMemberships(created._id, null, fields.exitDate);
    return { id: String(created._id), code };
  },
  { revalidate: REVALIDATE, message: "Employee added" },
);

export const updateEmployee = defineAction(
  employeeFormSchema.and(employeeIdSchema),
  async (input, user) => {
    const existing = await Employee.findById(input.id);
    if (!existing) throw notFound("The employee");
    await assertUnique(input, input.id);
    const isAdmin = user.role === "admin";
    const fields = baseFields(input);
    const monthlySalary = isAdmin ? round2(input.monthlySalary ?? 0) : (existing.monthlySalary ?? 0);

    const scheduleId = await syncSalarySchedule(existing, {
      name: input.name,
      status: input.status,
      joinDate: fields.joinDate,
      exitDate: fields.exitDate,
      monthlySalary,
      pay: Boolean(input.paySalary),
      userId: user.id,
      canChangePay: isAdmin,
    });

    const unset: Record<string, 1> = {};
    for (const key of ["email", "phone", "designation", "joinDate", "exitDate", "notes", "user"] as const) {
      if (fields[key] === undefined) unset[key] = 1;
    }
    await Employee.updateOne(
      { _id: existing._id },
      {
        $set: { ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)), monthlySalary, ...(scheduleId ? { salaryRecurring: scheduleId } : {}) },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
    );
    await syncMemberships(existing._id, existing.status === "exited" ? existing.exitDate : null, fields.exitDate);
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Employee updated" },
);

/** Only people with no pay history and no project history can be deleted; everyone else is marked as exited. */
export const deleteEmployee = defineAction(
  employeeIdSchema,
  async ({ id }) => {
    const existing = await Employee.findById(id).lean();
    if (!existing) throw notFound("The employee");
    const [expenses, memberships] = await Promise.all([Expense.exists({ employee: id }), ProjectMember.exists({ employee: id })]);
    if (expenses || memberships) {
      throw new AppError("This person has salary or project history. Mark them as exited instead of deleting.", "conflict");
    }
    // Their salary schedules go too, so nothing keeps paying someone who no longer exists. One that posted before
    // (its expense was deleted since) keeps its history, so it is ended instead.
    const theirs: QueryFilter<RecurringExpenseDoc> = {
      $or: [...(existing.salaryRecurring ? [linkedSalarySchedule(existing._id, existing.salaryRecurring)] : []), { employee: existing._id, category: "salaries" }],
    };
    await RecurringExpense.deleteMany({ ...theirs, occurrences: 0 });
    await RecurringExpense.updateMany({ ...theirs, status: { $ne: "ended" } }, { $set: { status: "ended" } });
    await Employee.deleteOne({ _id: existing._id });
    return { id };
  },
  { revalidate: REVALIDATE, message: "Employee deleted", role: "admin" },
);

/** Loads one employee for the edit form (salary stripped for members). */
export async function fetchEmployee(id: string): Promise<EmployeeDetail | null> {
  if (!(await getCurrentUser())) return null;
  return getEmployee(id);
}
