import type { AttendanceStatus, HrRules } from "../constants";
import type { DayKind } from "../salary/calc";

/** Types shared by the daily sheet's server query and its client components. Client-safe. */

/** The saved mark of one employee on the day, or null when nobody marked it. */
export type DailyMark = {
  status: AttendanceStatus;
  leaveType: string | null;
  inTime: string | null;
  outTime: string | null;
  notes: string | null;
  /** Set when a leave record wrote this mark. */
  leaveBatch: string | null;
  updatedAt: string | null;
};

export type DailyRow = {
  employeeId: string;
  name: string;
  code: string;
  designation: string | null;
  department: string;
  mark: DailyMark | null;
};

export type DailySheet = {
  /** "YYYY-MM-DD" */
  date: string;
  today: string;
  /** "YYYY-MM" */
  month: string;
  rules: HrRules;
  kind: DayKind;
  holidayName: string | null;
  /** The month's salary is finalised, so its attendance cannot change. */
  locked: boolean;
  /** The day is after today: only leave, holidays and weekly offs can be marked. */
  future: boolean;
  rows: DailyRow[];
  /** What the person may do on this sheet (the server checks every save again). */
  can: { create: boolean; edit: boolean; delete: boolean };
};

/** Statuses that may be marked on a day still to come. */
export const FUTURE_STATUSES: AttendanceStatus[] = ["leave", "holiday", "week_off"];

/**
 * A mark that may be saved on a day still to come: leave, a holiday, a weekly off, or a half day
 * of leave (the leave form writes those ahead too, as a half day with a leave type).
 */
export function allowedAhead(status: AttendanceStatus, leaveType: string | null | undefined): boolean {
  return FUTURE_STATUSES.includes(status) || (status === "half_day" && Boolean(leaveType));
}
