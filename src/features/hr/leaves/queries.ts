import "server-only";

import { cache } from "react";
import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee } from "@/server/models";
import type { HrRules } from "../constants";
import { employedOn, employeesBetween, finalisedMonths, holidaysBetween, marksBetween, monthOf, type HrEmployee } from "../server";
import { dayKind, leaveTypeOf } from "../salary/calc";
import { leaveUnits } from "./plan";
import type { LeaveBalances, LeaveBalanceType, LeaveRun } from "./types";

/** Reads for the leaves page. Nothing here writes. */

type Mark = Awaited<ReturnType<typeof marksBetween>>[number];

/** Every mark in a range, read once per request even when both the list and the balances need it. */
const marksInRange = cache((from: string, to: string) => marksBetween(from, to));
const employeesInRange = cache((from: string, to: string) => employeesBetween(from, to, { withSalary: false }));

const isLeaveMark = (m: Pick<Mark, "status" | "leaveType">) => leaveUnits(m) > 0;

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Names for people who left before the range or are otherwise not in the employee list. */
async function namesFor(ids: string[]): Promise<Map<string, { name: string; code: string }>> {
  if (!ids.length) return new Map();
  await connectDB();
  const rows = await Employee.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, { name: 1, code: 1 }).lean();
  return new Map(rows.map((e) => [String(e._id), { name: e.name, code: e.code }]));
}

/**
 * Leave records from `from` to `to`, newest first. Marks with status "leave", and half days that
 * carry a leave type, grouped by their leave batch when they have one; other leave marks (from the
 * daily sheet) are grouped when they are consecutive days of the same person, type and kind (full
 * or half). Weekly offs and holidays with no mark between two leave days do not break a run.
 */
export async function listLeaveRuns({
  from,
  to,
  rules,
  employeeId,
}: {
  from: string;
  to: string;
  rules: HrRules;
  employeeId?: string | null;
}): Promise<LeaveRun[]> {
  const [all, employees, holidayList] = await Promise.all([marksInRange(from, to), employeesInRange(from, to), holidaysBetween(from, to)]);
  const marks = employeeId ? all.filter((m) => m.employeeId === employeeId) : all;
  const holidays = new Map(holidayList.map((h) => [h.date, h.name]));

  // Days that carry any mark, per person: a marked day between two leave days ends a run.
  const markedDays = new Map<string, Set<string>>();
  for (const m of marks) {
    const set = markedDays.get(m.employeeId) ?? new Set<string>();
    set.add(m.date);
    markedDays.set(m.employeeId, set);
  }

  const groups: Mark[][] = [];
  const byBatch = new Map<string, Mark[]>();
  const loose = marks.filter(isLeaveMark).filter((m) => {
    if (!m.leaveBatch) return true;
    const key = `${m.employeeId}:${m.leaveBatch}`;
    const group = byBatch.get(key);
    if (group) group.push(m);
    else {
      const fresh = [m];
      byBatch.set(key, fresh);
      groups.push(fresh);
    }
    return false;
  });

  /** Only unmarked weekly offs and holidays lie strictly between a and b. */
  const onlyOffDaysBetween = (employee: string, a: string, b: string) => {
    const marked = markedDays.get(employee);
    for (let d = nextDay(a); d < b; d = nextDay(d)) {
      if (marked?.has(d) || dayKind(d, rules, holidays).kind === "working") return false;
    }
    return true;
  };

  loose.sort((a, b) => (a.employeeId === b.employeeId ? a.date.localeCompare(b.date) : a.employeeId.localeCompare(b.employeeId)));
  let current: Mark[] | null = null;
  for (const m of loose) {
    const last: Mark | undefined = current?.[current.length - 1];
    if (
      current &&
      last &&
      last.employeeId === m.employeeId &&
      last.leaveType === m.leaveType &&
      last.status === m.status &&
      onlyOffDaysBetween(m.employeeId, last.date, m.date)
    ) {
      current.push(m);
    } else {
      current = [m];
      groups.push(current);
    }
  }

  const byId = new Map(employees.map((e) => [e.id, e]));
  const missing = [...new Set(marks.map((m) => m.employeeId).filter((id) => !byId.has(id)))];
  const extraNames = await namesFor(missing);
  const allMonths = [...new Set(groups.flatMap((g) => g.map((m) => monthOf(m.date))))];
  const locked = await finalisedMonths(allMonths);

  const runs: LeaveRun[] = groups.map((group) => {
    group.sort((a, b) => a.date.localeCompare(b.date));
    const firstMark = group[0];
    const person = byId.get(firstMark.employeeId) ?? extraNames.get(firstMark.employeeId);
    const code = (firstMark.leaveType ?? "").toUpperCase();
    const type = leaveTypeOf(rules, code);
    const reasons = [...new Set(group.map((m) => m.notes?.trim()).filter((n): n is string => Boolean(n)))];
    return {
      key: firstMark.leaveBatch ? `b:${firstMark.employeeId}:${firstMark.leaveBatch}` : `d:${firstMark.id}`,
      ids: group.map((m) => m.id),
      employeeId: firstMark.employeeId,
      employeeName: person?.name ?? "Deleted employee",
      employeeCode: person?.code ?? "",
      leaveType: code || "?",
      typeName: type?.name ?? (code ? `${code} (not in the rules)` : "Type not given"),
      paid: type ? type.paid : null,
      from: firstMark.date,
      to: group[group.length - 1].date,
      days: group.reduce((sum, m) => sum + leaveUnits(m), 0),
      marks: group.length,
      halfDay: group.every((m) => m.status === "half_day"),
      reason: reasons.length ? reasons.join("; ") : null,
      batch: Boolean(firstMark.leaveBatch),
      locked: group.some((m) => locked.has(monthOf(m.date))),
    };
  });

  return runs.sort((a, b) => b.from.localeCompare(a.from) || b.to.localeCompare(a.to) || a.employeeName.localeCompare(b.employeeName));
}

/**
 * Leave used in a leave year: one row per person employed in it, the days of each type used.
 * Counted as calcSalary counts them: a leave day 1, a half day with a leave type 0.5, and only on
 * days the person was employed. Columns are the rules' leave types, then any other code found on
 * marks (a type since removed from the rules).
 */
export async function leaveBalances({
  from,
  to,
  rules,
  employeeId,
}: {
  from: string;
  to: string;
  rules: HrRules;
  employeeId?: string | null;
}): Promise<LeaveBalances> {
  const [all, everyone] = await Promise.all([marksInRange(from, to), employeesInRange(from, to)]);
  const employees: HrEmployee[] = employeeId ? everyone.filter((e) => e.id === employeeId) : everyone;
  const byId = new Map(employees.map((e) => [e.id, e]));

  const used = new Map<string, Record<string, number>>();
  const extraCodes = new Set<string>();
  for (const m of all) {
    const person = byId.get(m.employeeId);
    if (!person || !isLeaveMark(m) || !employedOn(person, m.date)) continue;
    const code = (m.leaveType ?? "").toUpperCase();
    if (!code) continue;
    if (!leaveTypeOf(rules, code)) extraCodes.add(code);
    const row = used.get(m.employeeId) ?? {};
    row[code] = (row[code] ?? 0) + leaveUnits(m);
    used.set(m.employeeId, row);
  }

  const types: LeaveBalanceType[] = [
    ...rules.leaveTypes.map((t) => ({ ...t, known: true })),
    ...[...extraCodes].sort().map((code) => ({ code, name: `${code} (not in the rules)`, paid: false, yearlyQuota: null, known: false })),
  ];

  return {
    types,
    rows: employees.map((e) => {
      const u = used.get(e.id) ?? {};
      return {
        employeeId: e.id,
        name: e.name,
        code: e.code,
        designation: e.designation ?? null,
        used: u,
        total: Object.values(u).reduce((s, n) => s + n, 0),
      };
    }),
  };
}

/** Employees employed at some point from `from` to `to`, for the record leave picker and the filter. No salary. */
export async function leaveEmployees(from: string, to: string) {
  const rows = await employeesInRange(from, to);
  return rows.map((e) => ({ id: e.id, name: e.name, code: e.code, designation: e.designation ?? null, joinDate: e.joinDate, exitDate: e.exitDate }));
}

/** People on leave on one day (a leave mark or half a day of leave). */
export async function onLeaveOn(date: string, employeeId?: string | null): Promise<number> {
  const rows = await marksBetween(date, date, employeeId ? [employeeId] : undefined);
  return rows.filter(isLeaveMark).length;
}
