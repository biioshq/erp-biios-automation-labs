/**
 * Salary from attendance. Pure and client-safe: the salary page, its export, the breakdown dialog
 * and the finalised snapshot all use this one function, so they always agree.
 *
 * How a month works out (HrRules in ../constants):
 * - Days before the join date or after the exit date are not paid and do not count.
 * - Weekly offs and holidays are paid. A working day is paid when present, on paid leave within
 *   the yearly allowance, or marked as a holiday / weekly off. Half a day is paid for a half day;
 *   the other half is paid only when it was paid leave. A half day worked on a weekly off or
 *   holiday without a leave type is paid in full (the rest is the off day) and its hours are overtime.
 * - Absent, unpaid leave and paid leave beyond the allowance are loss of pay (LOP), and so is
 *   leave with a code the rules do not know (with a warning). So are late arrivals on full days,
 *   half a day for every `lateMarksPerHalfDay` of them, when that rule is on.
 * - A working day nobody marked counts as the rules say (present by default). Days still to come
 *   this month count as paid, so the current month shows what it will be if nothing changes.
 * - Salary earned = monthly salary × payable days ÷ base days (days in the month, 30, or working
 *   days, by the salary basis). On fixed 30 days, a part month is its share of 30. Overtime,
 *   bonuses and deductions are added on top.
 */
import { round2 } from "@/lib/format";
import type { AttendanceStatus, HrRules, LeaveType, SalaryBasis } from "../constants";

export type CalcMark = {
  /** "YYYY-MM-DD" */
  date: string;
  status: AttendanceStatus;
  leaveType?: string | null;
  inTime?: string | null;
  outTime?: string | null;
};

export type CalcEmployee = {
  id: string;
  name: string;
  code: string;
  designation?: string | null;
  monthlySalary: number;
  /** "YYYY-MM-DD" or null */
  joinDate: string | null;
  exitDate: string | null;
};

export type CalcHoliday = { date: string; name: string };

export type CalcInput = {
  /** "YYYY-MM" */
  month: string;
  employee: CalcEmployee;
  /** This employee's marks in the month (others are ignored). */
  marks: CalcMark[];
  rules: HrRules;
  holidays: CalcHoliday[];
  /** Leave days of each type (by code) used earlier in the same leave year, before this month. */
  leaveUsedBefore?: Record<string, number>;
  adjustment?: { additions: number; deductions: number; note?: string | null } | null;
  /** "YYYY-MM-DD", today in India. Days after it are still to come. */
  today: string;
};

export type DayKind = "working" | "week_off" | "holiday";

export type SalaryDay = {
  date: string;
  kind: DayKind;
  holidayName: string | null;
  /** What the day counted as. */
  status: AttendanceStatus | "unmarked" | "upcoming" | "not_employed";
  leaveType: string | null;
  inTime: string | null;
  outTime: string | null;
  workedMinutes: number;
  late: boolean;
  overtimeMinutes: number;
  /** Paid share of the day: 0, 0.5 or 1. */
  paid: number;
  /** Loss of pay share of the day: 0, 0.5 or 1. */
  unpaid: number;
  /** Why a day was not paid, when it is not obvious ("Casual leave beyond the yearly allowance"). */
  note: string | null;
};

export type SalaryLine = {
  employeeId: string;
  name: string;
  code: string;
  designation: string | null;
  month: string;
  monthlySalary: number;
  basis: SalaryBasis;
  /** The divisor: days in the month, 30, or working days in the month. */
  baseDays: number;
  days: {
    inMonth: number;
    /** Days the person was employed in the month. */
    employed: number;
    working: number;
    weekOffs: number;
    holidays: number;
    present: number;
    halfDays: number;
    absent: number;
    leavePaid: number;
    leaveUnpaid: number;
    /** Working days up to today that nobody marked. */
    unmarked: number;
    /** Working days after today not marked yet (current month only). */
    upcoming: number;
    late: number;
    /** Days of pay lost to late arrivals. */
    lateDeduction: number;
    /** Every day of lost pay: absent, unpaid leave, unpaid halves, late arrivals, unmarked days when they count as absent. */
    lop: number;
    /** The days paid for, as used in the formula. */
    payable: number;
  };
  leaveByType: { code: string; name: string; days: number; paidDays: number }[];
  workedMinutes: number;
  overtimeMinutes: number;
  perDay: number;
  earned: number;
  overtimePay: number;
  additions: number;
  deductions: number;
  adjustmentNote: string | null;
  net: number;
  warnings: string[];
  breakdown: SalaryDay[];
};

/* Small helpers, also used by the pages. */

const pad = (n: number) => String(n).padStart(2, "0");

/** "09:30" → 570. Null for anything that is not a valid time. */
export function toMinutes(time: string | null | undefined): number | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Minutes between in and out; an out time before the in time ends on the next day. 0 without both. */
export function workedMinutes(inTime: string | null | undefined, outTime: string | null | undefined): number {
  const a = toMinutes(inTime);
  const b = toMinutes(outTime);
  if (a === null || b === null) return 0;
  return b >= a ? b - a : b + 24 * 60 - a;
}

/** "7h 05m" for 425 minutes; "" for 0. */
export function formatMinutes(minutes: number): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${pad(m)}m` : `${m}m`;
}

/** An arrival after the start time plus the grace minutes. */
export function isLate(inTime: string | null | undefined, rules: Pick<HrRules, "workStart" | "graceMinutes">): boolean {
  const t = toMinutes(inTime);
  const start = toMinutes(rules.workStart);
  return t !== null && start !== null && t > start + (rules.graceMinutes || 0);
}

/** The status the times suggest: present for a full day's hours, half day for half, null otherwise. */
export function suggestStatus(inTime: string | null | undefined, outTime: string | null | undefined, rules: Pick<HrRules, "fullDayHours" | "halfDayHours">): "present" | "half_day" | null {
  const worked = workedMinutes(inTime, outTime);
  if (!worked) return null;
  if (worked >= rules.fullDayHours * 60) return "present";
  if (worked >= rules.halfDayHours * 60) return "half_day";
  return null;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every day of a month: ["2026-11-01", ...]. */
export function monthDates(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** 0 (Sunday) to 6 (Saturday) for "YYYY-MM-DD". */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Working day, weekly off or holiday, by the rules and the holiday list. */
export function dayKind(date: string, rules: Pick<HrRules, "weeklyOffs" | "offSaturdays">, holidays: Map<string, string>): { kind: DayKind; holidayName: string | null } {
  const holidayName = holidays.get(date);
  if (holidayName !== undefined) return { kind: "holiday", holidayName };
  const weekday = weekdayOf(date);
  if (rules.weeklyOffs.includes(weekday)) return { kind: "week_off", holidayName: null };
  if (weekday === 6 && rules.offSaturdays.includes(Math.ceil(Number(date.slice(8, 10)) / 7))) return { kind: "week_off", holidayName: null };
  return { kind: "working", holidayName: null };
}

/** "YYYY-MM" of the first month of the leave year that holds `month`. */
export function leaveYearStart(month: string, startMonth: number): string {
  const [y, m] = month.split("-").map(Number);
  const start = Math.min(12, Math.max(1, Math.round(startMonth) || 1));
  return `${m >= start ? y : y - 1}-${pad(start)}`;
}

/** The leave year as a label: "2026" for a January year, "2026-27" for an April year. */
export function leaveYearLabel(month: string, startMonth: number): string {
  const first = leaveYearStart(month, startMonth);
  const y = Number(first.slice(0, 4));
  return startMonth <= 1 ? String(y) : `${y}-${String(y + 1).slice(2)}`;
}

/** "YYYY-MM" plus n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function leaveTypeOf(rules: Pick<HrRules, "leaveTypes">, code: string | null | undefined): LeaveType | null {
  if (!code) return null;
  return rules.leaveTypes.find((t) => t.code === code.toUpperCase()) ?? null;
}

/* The calculation. */

export function calcSalary(input: CalcInput): SalaryLine {
  const { month, employee, rules, today } = input;
  const dates = monthDates(month);
  const holidays = new Map(input.holidays.filter((h) => h.date.startsWith(month)).map((h) => [h.date, h.name]));
  const marks = new Map(input.marks.filter((m) => m.date.startsWith(month)).map((m) => [m.date, m]));
  const used: Record<string, number> = { ...(input.leaveUsedBefore ?? {}) };
  const leaveRows = new Map<string, { code: string; name: string; days: number; paidDays: number }>();
  const warnings: string[] = [];
  /** Leave codes on marks that the rules do not know ("" for leave without a type), with their days. */
  const unknownLeave = new Map<string, number>();
  const monthly = Math.max(0, Number(employee.monthlySalary) || 0);

  /** Splits `units` of leave of one type into paid and unpaid, against the yearly allowance. */
  const takeLeave = (code: string | null | undefined, units: number): { paid: number; unpaid: number; note: string | null } => {
    const type = leaveTypeOf(rules, code);
    const key = (code ?? "").toUpperCase() || "?";
    const row = leaveRows.get(key) ?? { code: key, name: type?.name ?? (code ? `${code} (not in the rules)` : "Leave, type not given"), days: 0, paidDays: 0 };
    leaveRows.set(key, row);
    row.days += units;
    if (!type) unknownLeave.set(code ? key : "", (unknownLeave.get(code ? key : "") ?? 0) + units);
    if (!type) return { paid: 0, unpaid: units, note: code ? `Leave type ${code} is not in the attendance rules, so it is not paid` : "Leave without a type is not paid" };
    const before = used[type.code] ?? 0;
    used[type.code] = before + units;
    if (!type.paid) return { paid: 0, unpaid: units, note: null };
    if (type.yearlyQuota === null) {
      row.paidDays += units;
      return { paid: units, unpaid: 0, note: null };
    }
    const left = Math.max(0, type.yearlyQuota - before);
    const paid = Math.min(units, left);
    row.paidDays += paid;
    return { paid, unpaid: units - paid, note: paid < units ? `${type.name} beyond the yearly allowance of ${type.yearlyQuota} days` : null };
  };

  const d = {
    inMonth: dates.length, employed: 0, working: 0, weekOffs: 0, holidays: 0, present: 0, halfDays: 0, absent: 0,
    leavePaid: 0, leaveUnpaid: 0, unmarked: 0, upcoming: 0, late: 0, lateDeduction: 0, lop: 0, payable: 0,
  };
  let employedWorking = 0;
  let unpaidTotal = 0;
  let paidTotal = 0;
  let unpaidWorking = 0;
  let worked = 0;
  let overtime = 0;
  const breakdown: SalaryDay[] = [];

  for (const date of dates) {
    const { kind, holidayName } = dayKind(date, rules, holidays);
    if (kind === "working") d.working++;
    else if (kind === "week_off") d.weekOffs++;
    else d.holidays++;

    const employed = (!employee.joinDate || date >= employee.joinDate) && (!employee.exitDate || date <= employee.exitDate);
    const mark = marks.get(date) ?? null;
    const day: SalaryDay = {
      date, kind, holidayName, status: "not_employed", leaveType: mark?.leaveType ?? null,
      inTime: mark?.inTime ?? null, outTime: mark?.outTime ?? null, workedMinutes: 0, late: false, overtimeMinutes: 0, paid: 0, unpaid: 0, note: null,
    };
    breakdown.push(day);
    if (!employed) continue;
    d.employed++;
    if (kind === "working") employedWorking++;

    if (!mark) {
      if (date > today) {
        day.status = "upcoming";
        day.paid = 1;
        if (kind === "working") d.upcoming++;
      } else if (kind !== "working") {
        day.status = kind;
        day.paid = 1;
      } else {
        day.status = "unmarked";
        d.unmarked++;
        if (rules.unmarkedDays === "unpaid") {
          day.unpaid = 1;
          day.note = "Not marked, counted as absent by the rules";
        } else day.paid = 1;
      }
    } else {
      day.status = mark.status;
      day.workedMinutes = mark.status === "present" || mark.status === "half_day" ? workedMinutes(mark.inTime, mark.outTime) : 0;
      worked += day.workedMinutes;
      switch (mark.status) {
        case "present":
          day.paid = 1;
          d.present++;
          break;
        case "half_day": {
          d.halfDays++;
          day.paid = 0.5;
          if (mark.leaveType) {
            const leave = takeLeave(mark.leaveType, 0.5);
            day.paid += leave.paid;
            day.unpaid = leave.unpaid;
            day.note = leave.note;
            d.leavePaid += leave.paid;
            d.leaveUnpaid += leave.unpaid;
          } else if (kind === "working") day.unpaid = 0.5;
          // Half a day worked on a weekly off or holiday: the rest of the day is the paid off day.
          else day.paid = 1;
          break;
        }
        case "absent":
          d.absent++;
          day.unpaid = 1;
          break;
        case "leave": {
          const leave = takeLeave(mark.leaveType, 1);
          day.paid = leave.paid;
          day.unpaid = leave.unpaid;
          day.note = leave.note;
          d.leavePaid += leave.paid;
          d.leaveUnpaid += leave.unpaid;
          break;
        }
        case "holiday":
        case "week_off":
          day.paid = 1;
          break;
      }
      // Only a full day can be late: a half day already costs the missing half, often the morning.
      if (mark.status === "present" && kind === "working" && isLate(mark.inTime, rules)) {
        day.late = true;
        d.late++;
      }
      // Overtime: hours past a full day on a working day, every hour worked on a weekly off or holiday.
      if (mark.status === "present" || mark.status === "half_day") {
        day.overtimeMinutes = kind === "working" ? (mark.status === "present" ? Math.max(0, day.workedMinutes - rules.fullDayHours * 60) : 0) : day.workedMinutes;
        overtime += day.overtimeMinutes;
      }
    }
    unpaidTotal += day.unpaid;
    paidTotal += day.paid;
    if (kind === "working") unpaidWorking += day.unpaid;
  }

  d.lateDeduction = rules.lateMarksPerHalfDay > 0 ? Math.floor(d.late / rules.lateMarksPerHalfDay) * 0.5 : 0;

  // Payable days and the divisor, by the salary basis.
  let baseDays: number;
  let payable: number;
  if (rules.salaryBasis === "working_days") {
    baseDays = d.working;
    payable = employedWorking - unpaidWorking - d.lateDeduction;
    d.lop = unpaidWorking + d.lateDeduction;
  } else if (rules.salaryBasis === "fixed_30") {
    baseDays = 30;
    // A full month is 30 days. A part month is its share of 30 (17 of 31 days is 16.45), so a day
    // outside employment costs about one day in every month: never nothing (a 31-day month) and
    // never three (February). Each unpaid day then costs one day in 30.
    const employedDays = d.employed === d.inMonth ? 30 : (d.employed * 30) / d.inMonth;
    payable = employedDays - unpaidTotal - d.lateDeduction;
    d.lop = unpaidTotal + d.lateDeduction;
  } else {
    baseDays = d.inMonth;
    payable = d.employed - unpaidTotal - d.lateDeduction;
    d.lop = unpaidTotal + d.lateDeduction;
  }
  // Nothing paid (every employed day unpaid) earns nothing, also on fixed_30 in a short month.
  if (paidTotal === 0) payable = 0;
  payable = Math.min(baseDays, Math.max(0, payable));
  d.payable = payable;

  const perDay = baseDays > 0 ? monthly / baseDays : 0;
  const earned = baseDays > 0 ? round2((monthly * payable) / baseDays) : 0;
  const hourly = rules.fullDayHours > 0 ? perDay / rules.fullDayHours : 0;
  const overtimePay = rules.overtimeRate > 0 ? round2((overtime / 60) * hourly * rules.overtimeRate) : 0;
  const additions = round2(Math.max(0, input.adjustment?.additions ?? 0));
  const deductions = round2(Math.max(0, input.adjustment?.deductions ?? 0));
  const gross = round2(earned + overtimePay + additions - deductions);
  const net = Math.max(0, gross);

  if (!monthly) warnings.push("No monthly salary is set for this person on the Employees page.");
  if (baseDays === 0) warnings.push("This month has no working days under the rules, so no salary is worked out.");
  if (d.unmarked) warnings.push(`${d.unmarked} working ${d.unmarked === 1 ? "day was" : "days were"} not marked and ${rules.unmarkedDays === "unpaid" ? "counted as absent" : "counted as present"}.`);
  for (const [code, days] of unknownLeave) {
    const count = `${days} ${days === 1 ? "day" : "days"}`;
    warnings.push(code ? `${count} of leave type ${code}, which is not in the attendance rules, ${days === 1 ? "is" : "are"} not paid.` : `${count} of leave without a type ${days === 1 ? "is" : "are"} not paid.`);
  }
  if (gross < 0) warnings.push("Deductions are more than the salary, so it is shown as zero.");

  return {
    employeeId: employee.id,
    name: employee.name,
    code: employee.code,
    designation: employee.designation ?? null,
    month,
    monthlySalary: monthly,
    basis: rules.salaryBasis,
    baseDays,
    days: d,
    leaveByType: [...leaveRows.values()],
    workedMinutes: worked,
    overtimeMinutes: overtime,
    perDay: round2(perDay),
    earned,
    overtimePay,
    additions,
    deductions,
    adjustmentNote: input.adjustment?.note ?? null,
    net,
    warnings,
    breakdown,
  };
}
