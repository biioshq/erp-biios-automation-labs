"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Employee, Expense, ProjectMember, RecurringExpense, User, type EmployeeDoc } from "@/server/models";
import { getCurrentUser } from "@/server/auth/session";
import { nextNumber } from "@/server/services/numbering";
import { fromDateInput, startOfDayIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { firstOccurrence } from "@/lib/recurrence";
import { employeeFormSchema, employeeIdSchema, type EmployeeFormValues } from "./schemas";
import { getEmployee } from "./queries";
import type { EmployeeDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/** Salary is paid on the last day of each month. */
const SALARY_DAY = 31;

/**
 * Keeps the employee's salary schedule (a monthly recurring expense) in step with the employee:
 * created when salary payment is switched on, amount follows the salary, paused when switched off,
 * ended when the employee exits. Returns the schedule id to store on the employee, if any.
 */
async function syncSalarySchedule(
  employee: Pick<EmployeeDoc, "_id" | "salaryRecurring">,
  opts: { name: string; status: string; joinDate?: Date; exitDate?: Date; monthlySalary: number; pay: boolean; userId: string; canChangePay: boolean },
): Promise<Types.ObjectId | undefined> {
  const existing = employee.salaryRecurring ? await RecurringExpense.findById(employee.salaryRecurring).lean() : null;
  const today = startOfDayIST();

  if (opts.status === "exited") {
    // Leaving ends the schedule, whoever records it.
    if (existing && existing.status !== "ended") {
      await RecurringExpense.updateOne({ _id: existing._id }, { $set: { status: "ended", endDate: opts.exitDate ?? today } });
    }
    return existing?._id;
  }
  if (!opts.canChangePay) return existing?._id;

  const name = `Salary: ${opts.name}`;
  const wants = opts.pay && opts.monthlySalary > 0;

  if (!wants) {
    if (existing && existing.status === "active") await RecurringExpense.updateOne({ _id: existing._id }, { $set: { status: "paused", name, vendor: opts.name } });
    else if (existing) await RecurringExpense.updateOne({ _id: existing._id }, { $set: { name, vendor: opts.name } });
    return existing?._id;
  }

  const amount = round2(opts.monthlySalary);
  if (existing) {
    const set: Record<string, unknown> = { name, vendor: opts.name, amount, employee: employee._id };
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

/** Ending a person's time at the company ends their open project memberships on the exit date. */
async function endMemberships(employeeId: Types.ObjectId, exitDate: Date) {
  await ProjectMember.updateMany({ employee: employeeId, endDate: null }, [{ $set: { endDate: { $max: ["$startDate", exitDate] } } }], { updatePipeline: true });
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
    if (fields.exitDate) await endMemberships(created._id, fields.exitDate);
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
    if (fields.exitDate) await endMemberships(existing._id, fields.exitDate);
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
    if (existing.salaryRecurring) await RecurringExpense.deleteOne({ _id: existing.salaryRecurring, occurrences: 0 });
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
