import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee } from "@/server/models";
import { AppError } from "@/server/errors";
import { toDateInput } from "@/lib/dates";
import { employedOn, finalisedMonths, getHrRules, holidaysBetween, marksBetween, monthOf, monthRange } from "../server";
import { addMonths, dayKind, leaveTypeOf, leaveYearLabel, leaveYearStart } from "../salary/calc";
import type { LeavePlan } from "./types";

/**
 * Works out what a leave record writes: the days, the days left out, the marks it would replace
 * and the balance before and after. The dialog's preview and recordLeave both use it, so what the
 * dialog shows is what gets saved. Reads only.
 */

const DAY_MS = 86_400_000;

/** Every day from `from` to `to` ("YYYY-MM-DD", both included). */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  for (let t = Date.UTC(fy, fm - 1, fd); t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The months ("YYYY-MM") a range of days touches. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The first and last day of the leave year that starts in `yearStart` ("YYYY-MM"). */
export function leaveYearRange(yearStart: string): { from: string; to: string } {
  return { from: `${yearStart}-01`, to: monthRange(addMonths(yearStart, 11)).to };
}

/** Leave days a mark counts for, as calcSalary counts them: leave 1, a half day with a leave type 0.5. */
export function leaveUnits(mark: { status: string; leaveType?: string | null }): number {
  if (mark.status === "leave") return 1;
  if (mark.status === "half_day" && mark.leaveType) return 0.5;
  return 0;
}

export type LeavePlanInput = {
  employeeId: string;
  leaveType: string;
  from: string;
  to: string;
  halfDay: boolean;
  skipOffDays: boolean;
};

export async function planLeave(input: LeavePlanInput): Promise<LeavePlan> {
  await connectDB();
  const { rules } = await getHrRules();

  const type = leaveTypeOf(rules, input.leaveType);
  if (!type) {
    throw new AppError("That leave type is not in the attendance rules. Pick another one, or add it on the Rules tab.", "invalid", {
      leaveType: ["Not in the attendance rules"],
    });
  }

  if (!Types.ObjectId.isValid(input.employeeId)) throw new AppError("Pick an employee", "invalid", { employeeId: ["Pick an employee"] });
  const doc = await Employee.findById(input.employeeId, { name: 1, code: 1, joinDate: 1, exitDate: 1, status: 1 }).lean();
  if (!doc) throw new AppError("That employee was not found. They may have been deleted.", "not_found", { employeeId: ["Not found"] });
  const person = {
    joinDate: doc.joinDate ? toDateInput(doc.joinDate) : null,
    exitDate: doc.exitDate ? toDateInput(doc.exitDate) : null,
  };
  // Someone marked as exited without an exit date has no days to mark (as on the daily sheet).
  const exitedWithoutDate = doc.status === "exited" && !person.exitDate;

  const holidayList = await holidaysBetween(input.from, input.to);
  const holidays = new Map(holidayList.map((h) => [h.date, h.name]));

  const days: string[] = [];
  const skippedOff: LeavePlan["skippedOff"] = [];
  let skippedNotEmployed = 0;
  for (const date of datesBetween(input.from, input.to)) {
    if (exitedWithoutDate || !employedOn(person, date)) {
      skippedNotEmployed++;
      continue;
    }
    const { kind, holidayName } = dayKind(date, rules, holidays);
    if (input.skipOffDays && kind !== "working") {
      skippedOff.push({ date, kind, holidayName });
      continue;
    }
    days.push(date);
  }
  const unitPerDay = input.halfDay ? 0.5 : 1;
  const recording = new Set(days);

  // What the recorded days hold now.
  const existing = await marksBetween(input.from, input.to, [input.employeeId]);
  const conflicts: LeavePlan["conflicts"] = [];
  let replacingLeave = 0;
  for (const m of existing) {
    if (!recording.has(m.date)) continue;
    if (m.status === "leave") replacingLeave++;
    else conflicts.push({ date: m.date, status: m.status, leaveType: m.leaveType ?? null });
  }

  const months = monthsBetween(input.from, input.to);
  const lockedMonths = [...(await finalisedMonths(months))].sort();

  // Balance in the leave year that holds the first day, counted the way calcSalary counts it.
  const yearStart = leaveYearStart(monthOf(input.from), rules.leaveYearStartMonth);
  const year = leaveYearRange(yearStart);
  const yearMarks = await marksBetween(year.from, year.to, [input.employeeId]);
  let usedBefore = 0;
  let replaced = 0;
  for (const m of yearMarks) {
    if (m.leaveType !== type.code || !employedOn(person, m.date)) continue;
    const units = leaveUnits(m);
    usedBefore += units;
    if (recording.has(m.date)) replaced += units;
  }
  const addedThisYear = days.filter((d) => d <= year.to).length * unitPerDay;

  return {
    employee: { id: String(doc._id), name: doc.name, code: doc.code },
    type,
    days,
    units: days.length * unitPerDay,
    skippedOff,
    skippedNotEmployed,
    conflicts,
    replacingLeave,
    months,
    lockedMonths,
    balance: {
      yearLabel: leaveYearLabel(monthOf(input.from), rules.leaveYearStartMonth),
      allowance: type.yearlyQuota,
      usedBefore,
      usedAfter: usedBefore - replaced + addedThisYear,
      spansYears: input.to > year.to,
    },
  };
}
