/**
 * The monthly register's cells, codes and labels. Client-safe: the page, the legend and the
 * export all read the grid built from these, so the screen and the downloaded file match.
 */
import { attendanceStatusLabel, type AttendanceStatus, type LeaveType } from "../constants";
import { leaveTypeOf, type CalcMark, type DayKind, type SalaryDay } from "../salary/calc";

/** How a cell is tinted (keys of ATTENDANCE_CELL, plus "blank" for a day still to come). */
export type RegisterTone = AttendanceStatus | "unmarked" | "off" | "not_employed" | "blank";

export type RegisterCell = {
  date: string;
  /** "P", "HD", "A", the leave code ("CL"), "H", "WO", or "" (not marked, still to come, not employed). */
  code: string;
  tone: RegisterTone;
  /** HR marked this day (the code is not just the weekly off or holiday from the rules). */
  marked: boolean;
  late: boolean;
  employed: boolean;
  /** "Asha, 3 Nov: Present 09:42 to 18:30, late" */
  label: string;
};

export type RegisterDay = {
  date: string;
  day: number;
  /** "M" */
  weekday: string;
  /** "Monday" */
  weekdayName: string;
  kind: DayKind;
  holidayName: string | null;
  isToday: boolean;
};

export type RegisterTotals = {
  present: number;
  halfDays: number;
  absent: number;
  /** Leave days; a half day with a leave type counts half a day, as on the Salary tab. */
  leave: number;
  late: number;
  /** Working days up to today with no mark. */
  unmarked: number;
  workedMinutes: number;
};

export type RegisterRow = {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  cells: RegisterCell[];
  totals: RegisterTotals;
};

export type Register = {
  month: string;
  /** "November 2026" */
  label: string;
  today: string;
  /** The month's salary is finalised, so its attendance cannot change. */
  locked: boolean;
  days: RegisterDay[];
  /** Working days in the month under the rules. */
  workingDays: number;
  rows: RegisterRow[];
  leaveTypes: Pick<LeaveType, "code" | "name">[];
  holidays: { date: string; name: string }[];
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "November 2026" for "2026-11". */
export function monthLabel(month: string): string {
  return new Date(`${month}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "3 Nov" for "2026-11-03". */
export function dayLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "";
}

/** "Present 09:42 to 18:30", "Present, in 09:42". */
function withTimes(text: string, inTime: string | null | undefined, outTime: string | null | undefined): string {
  if (inTime && outTime) return `${text} ${inTime} to ${outTime}`;
  if (inTime) return `${text}, in ${inTime}`;
  if (outTime) return `${text}, out ${outTime}`;
  return text;
}

function leaveName(rules: { leaveTypes: LeaveType[] }, code: string | null | undefined): string {
  if (!code) return "type not given";
  const type = leaveTypeOf(rules, code);
  return type ? `${type.name} (${type.code})` : `${code.toUpperCase()} (not in the attendance rules)`;
}

/**
 * Leave codes in the register that the rules do not list (a leave type removed after it was used),
 * so the legends can say what they are.
 */
export function unknownLeaveCodes(register: Pick<Register, "rows" | "leaveTypes">): string[] {
  const known = new Set(register.leaveTypes.map((t) => t.code.toUpperCase()));
  const found = new Set<string>();
  for (const row of register.rows) {
    for (const cell of row.cells) {
      if (cell.tone === "leave" && cell.code && cell.code !== "L" && !known.has(cell.code)) found.add(cell.code);
    }
  }
  return [...found].sort();
}

/** The short code for a mark: the leave code for leave ("CL"), else the status code ("P"). */
export function markCode(mark: Pick<CalcMark, "status" | "leaveType">): string {
  if (mark.status === "leave") return mark.leaveType ? mark.leaveType.toUpperCase() : "L";
  switch (mark.status) {
    case "present":
      return "P";
    case "half_day":
      return "HD";
    case "absent":
      return "A";
    case "holiday":
      return "H";
    case "week_off":
      return "WO";
  }
}

/**
 * One cell of the register. `day` is the salary breakdown's day (its kind, late flag and whether the
 * person was employed); `mark` is HR's mark for that day, if any.
 */
export function buildCell({
  name,
  day,
  mark,
  today,
  rules,
}: {
  name: string;
  day: SalaryDay;
  mark: CalcMark | null;
  today: string;
  rules: { leaveTypes: LeaveType[] };
}): RegisterCell {
  const prefix = `${name}, ${dayLabel(day.date)}: `;
  const base = { date: day.date, late: false, employed: true, marked: false };
  const offText = day.kind === "holiday" ? `Holiday${day.holidayName ? `, ${day.holidayName}` : ""}` : "Weekly off";

  if (day.status === "not_employed") {
    return { ...base, employed: false, code: "", tone: "not_employed", label: `${prefix}not employed on this day` };
  }

  if (mark) {
    let text: string;
    switch (mark.status) {
      case "present":
        text = withTimes("Present", mark.inTime, mark.outTime);
        break;
      case "half_day":
        text = withTimes("Half day", mark.inTime, mark.outTime);
        if (mark.leaveType) text += `, ${leaveName(rules, mark.leaveType)} for the other half`;
        break;
      case "leave":
        text = `Leave, ${leaveName(rules, mark.leaveType)}`;
        break;
      case "holiday":
        text = day.kind === "holiday" ? offText : "Holiday";
        break;
      default:
        text = attendanceStatusLabel(mark.status);
    }
    if (day.late) text += ", late";
    if (day.kind !== "working" && (mark.status === "present" || mark.status === "half_day")) text += ` (${offText.toLowerCase()})`;
    return { ...base, marked: true, late: day.late, code: markCode(mark), tone: mark.status, label: prefix + text };
  }

  if (day.kind !== "working") {
    return { ...base, code: day.kind === "holiday" ? "H" : "WO", tone: "off", label: prefix + offText };
  }
  if (day.date <= today) return { ...base, code: "", tone: "unmarked", label: `${prefix}Not marked` };
  return { ...base, code: "", tone: "blank", label: `${prefix}Not marked yet` };
}
