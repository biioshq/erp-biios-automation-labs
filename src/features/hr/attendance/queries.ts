import "server-only";

import { can, type SessionUser } from "@/server/auth/session";
import { dayKind } from "../salary/calc";
import { employedOn, employeesBetween, finalisedMonths, getHrRules, holidaysBetween, marksBetween, monthOf, todayIST } from "../server";
import type { DailyRow, DailySheet } from "./types";

/**
 * Everything the daily attendance page needs for one day: the rules, what kind of day it is,
 * whether the month is locked, and one row per employee employed that day with their saved mark.
 * Salaries are never read here.
 */
export async function getDailySheet(date: string, user: SessionUser): Promise<DailySheet> {
  const month = monthOf(date);
  const [{ rules }, holidays, employees, marks, locked] = await Promise.all([
    getHrRules(),
    holidaysBetween(date, date),
    employeesBetween(date, date, { withSalary: false }),
    marksBetween(date, date),
    finalisedMonths([month]),
  ]);

  const { kind, holidayName } = dayKind(date, rules, new Map(holidays.map((h) => [h.date, h.name])));
  const byEmployee = new Map(marks.map((m) => [m.employeeId, m]));

  const rows: DailyRow[] = employees
    .filter((e) => employedOn(e, date))
    .map((e) => {
      const m = byEmployee.get(e.id);
      return {
        employeeId: e.id,
        name: e.name,
        code: e.code,
        designation: e.designation ?? null,
        department: e.department,
        mark: m
          ? {
              status: m.status,
              leaveType: m.leaveType ?? null,
              inTime: m.inTime ?? null,
              outTime: m.outTime ?? null,
              notes: m.notes,
              leaveBatch: m.leaveBatch,
              updatedAt: m.updatedAt,
            }
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-IN", { sensitivity: "base" }));

  const today = todayIST();
  return {
    date,
    today,
    month,
    rules,
    kind,
    holidayName,
    locked: locked.has(month),
    future: date > today,
    rows,
    can: {
      create: can(user, "hr.attendance:create"),
      edit: can(user, "hr.attendance:edit"),
      delete: can(user, "hr.attendance:delete"),
    },
  };
}
