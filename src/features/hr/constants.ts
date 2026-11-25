/**
 * HR attendance: day statuses, the default attendance rules and their types. Client-safe.
 *
 * Attendance is one mark per employee per day. Times are "HH:mm" in India time, never Date objects,
 * so a mark reads the same on every server and browser. An out time earlier than the in time means
 * the shift ran past midnight (a night shift): it ends on the next day.
 */

export const ATTENDANCE_STATUSES = [
  { value: "present", label: "Present", short: "P" },
  { value: "half_day", label: "Half day", short: "HD" },
  { value: "absent", label: "Absent", short: "A" },
  { value: "leave", label: "Leave", short: "L" },
  { value: "holiday", label: "Holiday", short: "H" },
  { value: "week_off", label: "Weekly off", short: "WO" },
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]["value"];
export const ATTENDANCE_STATUS_VALUES = ATTENDANCE_STATUSES.map((s) => s.value) as [AttendanceStatus, ...AttendanceStatus[]];

export function attendanceStatusLabel(status: AttendanceStatus | null | undefined): string {
  return ATTENDANCE_STATUSES.find((s) => s.value === status)?.label ?? "Not marked";
}

/** Statuses that carry in and out times. */
export const TIMED_STATUSES: AttendanceStatus[] = ["present", "half_day"];

/** "HH:mm", 00:00 to 23:59. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const SALARY_BASES = [
  { value: "calendar_days", label: "Days in the month", description: "Monthly salary ÷ days in that month (28 to 31). Weekly offs and holidays are paid." },
  { value: "fixed_30", label: "Fixed 30 days", description: "Monthly salary ÷ 30, every month." },
  { value: "working_days", label: "Working days", description: "Monthly salary ÷ working days in that month (leaving out weekly offs and holidays)." },
] as const;
export type SalaryBasis = (typeof SALARY_BASES)[number]["value"];

export const UNMARKED_RULES = [
  { value: "paid", label: "Count as present", description: "A working day nobody marked is paid. The salary page shows how many days were not marked." },
  { value: "unpaid", label: "Count as absent", description: "A working day nobody marked is not paid." },
] as const;
export type UnmarkedRule = (typeof UNMARKED_RULES)[number]["value"];

export const WEEKDAYS = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
] as const;

export type LeaveType = {
  /** Short code shown in the register ("CL"). Stored on attendance marks; never reuse a code for another leave type. */
  code: string;
  name: string;
  /** Paid leave keeps the day's salary while the yearly allowance lasts. */
  paid: boolean;
  /** Days allowed per leave year; null means no limit. Paid leave beyond it is not paid. */
  yearlyQuota: number | null;
};

export type HrRules = {
  /** Office start and end, "HH:mm" India time. */
  workStart: string;
  workEnd: string;
  /** Minutes after the start time before an arrival counts as late. */
  graceMinutes: number;
  /** Hours worked that make a full day; overtime counts after this. */
  fullDayHours: number;
  /** Hours worked that make at least a half day (used to suggest the status from the times). */
  halfDayHours: number;
  /** Weekdays that are always off (0 Sunday to 6 Saturday). */
  weeklyOffs: number[];
  /** Saturdays of the month that are off, by number (2 and 4 for "second and fourth Saturday"). */
  offSaturdays: number[];
  salaryBasis: SalaryBasis;
  unmarkedDays: UnmarkedRule;
  /** Every this many late arrivals in a month cost half a day's salary. 0 turns it off. */
  lateMarksPerHalfDay: number;
  /** Overtime is paid at this many times the hourly rate. 0 turns overtime pay off. */
  overtimeRate: number;
  leaveTypes: LeaveType[];
  /** The month (1 to 12) a leave year starts: 1 for January, 4 for April. */
  leaveYearStartMonth: number;
};

/** The rules until someone saves their own. Reading them never writes anything. */
export const DEFAULT_HR_RULES: HrRules = {
  workStart: "09:30",
  workEnd: "18:30",
  graceMinutes: 15,
  fullDayHours: 8,
  halfDayHours: 4,
  weeklyOffs: [0],
  offSaturdays: [],
  salaryBasis: "calendar_days",
  unmarkedDays: "paid",
  lateMarksPerHalfDay: 0,
  overtimeRate: 0,
  leaveTypes: [
    { code: "CL", name: "Casual leave", paid: true, yearlyQuota: 12 },
    { code: "SL", name: "Sick leave", paid: true, yearlyQuota: 6 },
    { code: "EL", name: "Earned leave", paid: true, yearlyQuota: 15 },
    { code: "LOP", name: "Unpaid leave", paid: false, yearlyQuota: null },
  ],
  leaveYearStartMonth: 1,
};
