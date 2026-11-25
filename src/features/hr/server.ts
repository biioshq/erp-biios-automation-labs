import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Attendance, Employee, HrHoliday, HrSettings, PayrollRun } from "@/server/models";
import { AppError } from "@/server/errors";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { DEFAULT_HR_RULES, type HrRules } from "./constants";
import { hrRulesSchema } from "./schemas";
import { addMonths, daysInMonth, leaveYearStart, type CalcEmployee, type CalcHoliday, type CalcMark } from "./salary/calc";

/**
 * Shared server reads and checks for HR. Every HR page and action goes through these, so the
 * daily sheet, the register, leaves and salary agree on who is employed, the rules and the locks.
 */

/** Today in India, "YYYY-MM-DD". */
export function todayIST(): string {
  return toDateInput(new Date());
}

/** "2026-11-19" → "2026-11". */
export const monthOf = (date: string) => date.slice(0, 7);

/** The first and last day of a month as "YYYY-MM-DD". */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

/** The attendance rules: the saved ones, or the defaults when none were saved. Never writes. */
export async function getHrRules(): Promise<{ rules: HrRules; saved: boolean; updatedAt: string | null }> {
  await connectDB();
  const doc = await HrSettings.findOne({ key: "default" }).lean();
  if (!doc) return { rules: DEFAULT_HR_RULES, saved: false, updatedAt: null };
  const parsed = hrRulesSchema.safeParse({ ...DEFAULT_HR_RULES, ...(doc.rules as Partial<HrRules>) });
  if (!parsed.success) {
    console.warn("[hr] saved attendance rules did not validate; using the defaults", parsed.error.issues[0]);
    return { rules: DEFAULT_HR_RULES, saved: true, updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null };
  }
  return { rules: parsed.data, saved: true, updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null };
}

/** Holidays from `from` to `to` ("YYYY-MM-DD", both included), oldest first. */
export async function holidaysBetween(from: string, to: string): Promise<(CalcHoliday & { id: string })[]> {
  await connectDB();
  const rows = await HrHoliday.find({ date: { $gte: fromDateInput(from), $lte: fromDateInput(to) } })
    .sort({ date: 1 })
    .lean();
  return rows.map((h) => ({ id: String(h._id), date: toDateInput(h.date), name: h.name }));
}

export type HrEmployee = CalcEmployee & {
  department: string;
  status: string;
  employmentType: string;
};

/**
 * Employees who were employed on at least one day from `from` to `to`: joined on or before `to`
 * (or no join date), and not gone before `from` (no exit date, or an exit date on or after `from`).
 * Someone marked "exited" without an exit date has no days to mark and is left out.
 * `monthlySalary` is 0 unless `withSalary` (callers pass it only with the salaries data permission).
 */
export async function employeesBetween(from: string, to: string, opts: { withSalary: boolean }): Promise<HrEmployee[]> {
  await connectDB();
  const start = fromDateInput(from);
  const end = fromDateInput(to);
  const rows = await Employee.find(
    {
      $and: [
        { $or: [{ joinDate: null }, { joinDate: { $exists: false } }, { joinDate: { $lte: end } }] },
        { $or: [{ exitDate: { $gte: start } }, { $and: [{ $or: [{ exitDate: null }, { exitDate: { $exists: false } }] }, { status: { $ne: "exited" } }] }] },
      ],
    },
    { code: 1, name: 1, designation: 1, department: 1, status: 1, employmentType: 1, joinDate: 1, exitDate: 1, ...(opts.withSalary ? { monthlySalary: 1 } : {}) },
  )
    .sort({ name: 1 })
    .lean();
  return rows.map((e) => ({
    id: String(e._id),
    name: e.name,
    code: e.code,
    designation: e.designation ?? null,
    department: e.department ?? "engineering",
    status: e.status ?? "active",
    employmentType: e.employmentType ?? "full_time",
    joinDate: e.joinDate ? toDateInput(e.joinDate) : null,
    exitDate: e.exitDate ? toDateInput(e.exitDate) : null,
    monthlySalary: opts.withSalary ? Number(e.monthlySalary ?? 0) : 0,
  }));
}

/** True when the employee was employed on that day. */
export function employedOn(e: Pick<CalcEmployee, "joinDate" | "exitDate">, date: string): boolean {
  return (!e.joinDate || date >= e.joinDate) && (!e.exitDate || date <= e.exitDate);
}

/** Attendance marks from `from` to `to`, optionally for some employees, as plain rows. */
export async function marksBetween(
  from: string,
  to: string,
  employeeIds?: string[],
): Promise<(CalcMark & { id: string; employeeId: string; notes: string | null; leaveBatch: string | null; updatedAt: string | null })[]> {
  await connectDB();
  const rows = await Attendance.find({
    date: { $gte: fromDateInput(from), $lte: fromDateInput(to) },
    ...(employeeIds ? { employee: { $in: employeeIds.map((id) => new Types.ObjectId(id)) } } : {}),
  })
    .sort({ date: 1 })
    .lean();
  return rows.map((a) => ({
    id: String(a._id),
    employeeId: String(a.employee),
    date: toDateInput(a.date),
    status: a.status as CalcMark["status"],
    leaveType: a.leaveType ?? null,
    inTime: a.inTime ?? null,
    outTime: a.outTime ?? null,
    notes: a.notes ?? null,
    leaveBatch: a.leaveBatch ?? null,
    updatedAt: a.updatedAt ? new Date(a.updatedAt).toISOString() : null,
  }));
}

/**
 * Leave days of each type each employee used from the start of the leave year up to (not
 * including) `month`. A half day with a leave type counts half a day.
 */
export async function leaveUsedBefore(month: string, leaveYearStartMonth: number, employeeIds: string[]): Promise<Map<string, Record<string, number>>> {
  const first = leaveYearStart(month, leaveYearStartMonth);
  const out = new Map<string, Record<string, number>>();
  if (first >= month || !employeeIds.length) return out;
  const last = addMonths(month, -1);
  const rows = await marksBetween(`${first}-01`, monthRange(last).to, employeeIds);
  for (const r of rows) {
    if (!r.leaveType || (r.status !== "leave" && r.status !== "half_day")) continue;
    const used = out.get(r.employeeId) ?? {};
    used[r.leaveType] = (used[r.leaveType] ?? 0) + (r.status === "leave" ? 1 : 0.5);
    out.set(r.employeeId, used);
  }
  return out;
}

/** The months ("YYYY-MM") among these that are finalised. */
export async function finalisedMonths(months: string[]): Promise<Set<string>> {
  await connectDB();
  if (!months.length) return new Set();
  const rows = await PayrollRun.find({ month: { $in: [...new Set(months)] }, status: "finalised" }, { month: 1 }).lean();
  return new Set(rows.map((r) => r.month));
}

/** Refuses a change to attendance, leave or adjustments in a finalised month. */
export async function assertMonthsOpen(months: string[]) {
  const locked = [...(await finalisedMonths(months))].sort();
  if (locked.length) {
    const names = locked.map((m) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }));
    throw new AppError(
      `The salary for ${names.join(" and ")} is finalised, so its attendance is locked. Reopen the month on the Salary tab to change it.`,
      "conflict",
    );
  }
}
