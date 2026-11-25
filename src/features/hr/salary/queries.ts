import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, PayrollAdjustment, PayrollRun, User } from "@/server/models";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { DEFAULT_HR_RULES, type HrRules } from "../constants";
import { hrRulesSchema } from "../schemas";
import { employeesBetween, getHrRules, holidaysBetween, leaveUsedBefore, marksBetween, monthRange, todayIST } from "../server";
import { addMonths, calcSalary, type CalcMark, type SalaryLine } from "./calc";
import type { SalaryMonthData, SalaryRow, SalaryRunInfo, SalaryTotals } from "./types";

/**
 * Reads for the salary page, its export and the finalise action. The page, the export and a
 * finalised snapshot all come from computeSalaryLines, so they always agree. Nothing here writes.
 */

/** Warnings that would tell someone without the salaries permission about a person's pay. */
const AMOUNT_WARNINGS = [/^No monthly salary/, /^Deductions are more/];

/** A line with every rupee figure removed, for people without "data.salaries". */
function withoutAmounts(line: SalaryLine): SalaryLine {
  return {
    ...line,
    monthlySalary: 0,
    perDay: 0,
    earned: 0,
    overtimePay: 0,
    additions: 0,
    deductions: 0,
    net: 0,
    adjustmentNote: null,
    warnings: line.warnings.filter((w) => !AMOUNT_WARNINGS.some((r) => r.test(w))),
  };
}

/** Bonuses and deductions saved for a month, by employee id. */
async function adjustmentsFor(month: string): Promise<Map<string, { additions: number; deductions: number; note: string | null }>> {
  await connectDB();
  const rows = await PayrollAdjustment.find({ month }).lean();
  return new Map(
    rows.map((a) => [String(a.employee), { additions: Number(a.additions ?? 0), deductions: Number(a.deductions ?? 0), note: a.note ?? null }]),
  );
}

/**
 * Works out every employed person's salary for a month from attendance, live. `withSalary` false
 * never loads a monthly salary or an adjustment, and the lines carry no amounts.
 */
export async function computeSalaryLines(month: string, opts: { withSalary: boolean }): Promise<{ lines: SalaryLine[]; rules: HrRules }> {
  const { from, to } = monthRange(month);
  const [{ rules }, employees, holidays] = await Promise.all([
    getHrRules(),
    employeesBetween(from, to, { withSalary: opts.withSalary }),
    holidaysBetween(from, to),
  ]);
  if (!employees.length) return { lines: [], rules };
  const ids = employees.map((e) => e.id);
  const [marks, used, adjustments] = await Promise.all([
    marksBetween(from, to, ids),
    leaveUsedBefore(month, rules.leaveYearStartMonth, ids),
    opts.withSalary ? adjustmentsFor(month) : Promise.resolve(new Map<string, { additions: number; deductions: number; note: string | null }>()),
  ]);
  const marksBy = new Map<string, CalcMark[]>();
  for (const m of marks) {
    const list = marksBy.get(m.employeeId) ?? [];
    list.push({ date: m.date, status: m.status, leaveType: m.leaveType, inTime: m.inTime, outTime: m.outTime });
    marksBy.set(m.employeeId, list);
  }
  const today = todayIST();
  const lines = employees.map((employee) =>
    calcSalary({
      month,
      employee,
      marks: marksBy.get(employee.id) ?? [],
      rules,
      holidays,
      leaveUsedBefore: used.get(employee.id),
      adjustment: adjustments.get(employee.id) ?? null,
      today,
    }),
  );
  return { lines: opts.withSalary ? lines : lines.map(withoutAmounts), rules };
}

export function salaryTotals(lines: SalaryLine[]): SalaryTotals {
  const sum = (pick: (l: SalaryLine) => number) => round2(lines.reduce((s, l) => s + (Number(pick(l)) || 0), 0));
  const monthlySalary = sum((l) => l.monthlySalary);
  const earned = sum((l) => l.earned);
  return {
    people: lines.length,
    monthlySalary,
    earned,
    lopDays: sum((l) => l.days.lop),
    // Pay lost to loss-of-pay days only; joining or leaving part-way through the month is not loss of pay.
    lopAmount: sum((l) => (l.baseDays > 0 ? Math.min(l.monthlySalary, (l.monthlySalary * l.days.lop) / l.baseDays) : 0)),
    overtimeMinutes: sum((l) => l.overtimeMinutes),
    overtimePay: sum((l) => l.overtimePay),
    additions: sum((l) => l.additions),
    deductions: sum((l) => l.deductions),
    net: sum((l) => l.net),
    unmarked: sum((l) => l.days.unmarked),
  };
}

/** Sum of "salaries" expenses dated in the month, by employee. Read only. */
async function bookedByEmployee(month: string, employeeIds: string[]): Promise<Map<string, number>> {
  const ids = employeeIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (!ids.length) return new Map();
  await connectDB();
  const { from } = monthRange(month);
  const rows = await Expense.aggregate<{ _id: Types.ObjectId; total: number }>([
    {
      $match: {
        category: "salaries",
        employee: { $in: ids },
        date: { $gte: fromDateInput(from), $lt: fromDateInput(`${addMonths(month, 1)}-01`) },
      },
    },
    { $group: { _id: "$employee", total: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), round2(r.total)]));
}

async function userNames(ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const list = ids.filter((id): id is Types.ObjectId => Boolean(id));
  if (!list.length) return new Map();
  const rows = await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean();
  return new Map(rows.map((u) => [String(u._id), u.name || u.email || "Someone"]));
}

/** The rules a finalised month was worked out with, or null when they were not stored or do not validate. */
function storedRules(raw: unknown): HrRules | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = hrRulesSchema.safeParse({ ...DEFAULT_HR_RULES, ...(raw as Partial<HrRules>) });
  return parsed.success ? parsed.data : null;
}

/**
 * Everything the salary page and the export show for a month: the stored lines of a finalised
 * month, otherwise the lines worked out live. Amounts only with `withSalary`.
 */
export async function getSalaryMonth(month: string, opts: { withSalary: boolean }): Promise<SalaryMonthData> {
  await connectDB();
  const run = await PayrollRun.findOne({ month }).lean();
  const finalised = run?.status === "finalised";

  let lines: SalaryLine[];
  let rules: HrRules;
  if (finalised) {
    lines = (run.lines ?? []) as SalaryLine[];
    rules = storedRules(run.rules) ?? (await getHrRules()).rules;
    if (!opts.withSalary) lines = lines.map(withoutAmounts);
  } else {
    ({ lines, rules } = await computeSalaryLines(month, opts));
  }

  const [booked, names] = await Promise.all([
    opts.withSalary ? bookedByEmployee(month, lines.map((l) => l.employeeId)) : Promise.resolve(null),
    run ? userNames([run.finalisedBy, run.reopenedBy]) : Promise.resolve(new Map<string, string>()),
  ]);

  const rows: SalaryRow[] = lines.map((l) => ({ ...l, booked: booked ? (booked.get(l.employeeId) ?? 0) : null }));
  const info: SalaryRunInfo | null = run
    ? {
        status: run.status as SalaryRunInfo["status"],
        finalisedAt: run.finalisedAt ? new Date(run.finalisedAt).toISOString() : null,
        finalisedByName: run.finalisedBy ? (names.get(String(run.finalisedBy)) ?? null) : null,
        reopenedAt: run.reopenedAt ? new Date(run.reopenedAt).toISOString() : null,
        reopenedByName: run.reopenedBy ? (names.get(String(run.reopenedBy)) ?? null) : null,
      }
    : null;

  return {
    month,
    rules,
    rows,
    totals: salaryTotals(lines),
    finalised,
    run: info,
    withSalary: opts.withSalary,
    bookedTotal: booked ? round2(rows.reduce((s, r) => s + (r.booked ?? 0), 0)) : null,
  };
}
