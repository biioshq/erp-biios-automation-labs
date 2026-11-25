import type { AttendanceStatus, LeaveType } from "../constants";
import type { DayKind } from "../salary/calc";

/** Shapes the leaves page, its queries and its actions share. Client-safe. */

/** One leave record as listed: the marks of one leave batch, or consecutive leave days of one person and type. */
export type LeaveRun = {
  /** Stable key for the list. */
  key: string;
  /** The attendance mark ids in this run (what deleteLeave takes). */
  ids: string[];
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveType: string;
  /** The type's name from the rules, or the code when the rules no longer have it. */
  typeName: string;
  /** Paid or unpaid by the rules; null when the type is not in the rules. */
  paid: boolean | null;
  from: string;
  to: string;
  /** Leave days: a leave day counts 1, a half day with a leave type 0.5. */
  days: number;
  /** Marks in the run (days on the calendar that carry leave). */
  marks: number;
  /** Every mark is a half day of leave. */
  halfDay: boolean;
  reason: string | null;
  /** Written by one "Record leave" (shares a leave batch id). */
  batch: boolean;
  /** A month the run touches has a finalised salary, so it cannot be deleted. */
  locked: boolean;
};

export type LeaveBalanceType = LeaveType & {
  /** False for a code found on marks that the rules no longer list. */
  known: boolean;
};

export type LeaveBalanceRow = {
  employeeId: string;
  name: string;
  code: string;
  designation: string | null;
  /** Leave days used in the leave year, by type code. */
  used: Record<string, number>;
  total: number;
};

export type LeaveBalances = {
  types: LeaveBalanceType[];
  rows: LeaveBalanceRow[];
};

/** An employee in the record leave picker and the employee filter. */
export type LeaveEmployeeOption = {
  id: string;
  name: string;
  code: string;
  designation: string | null;
  joinDate: string | null;
  exitDate: string | null;
};

/** What "Record leave" would write, worked out on the server before saving. */
export type LeavePlan = {
  employee: { id: string; name: string; code: string };
  type: LeaveType;
  /** The days that get a leave mark, oldest first. */
  days: string[];
  /** Leave days those marks add up to (0.5 for a half day). */
  units: number;
  /** Weekly offs and holidays left out of the range. */
  skippedOff: { date: string; kind: DayKind; holidayName: string | null }[];
  /** Days in the range outside the person's employment. */
  skippedNotEmployed: number;
  /** Recorded days that already carry a mark that is not leave. */
  conflicts: { date: string; status: AttendanceStatus; leaveType: string | null }[];
  /** Recorded days that already carry a leave mark, which is replaced. */
  replacingLeave: number;
  /** Months ("YYYY-MM") the range touches. */
  months: string[];
  /** Of those, the months whose salary is finalised. */
  lockedMonths: string[];
  /** The person's use of this leave type in the leave year that holds the first day. */
  balance: {
    yearLabel: string;
    allowance: number | null;
    usedBefore: number;
    usedAfter: number;
    /** The range runs past the end of that leave year; days after it count in the next one. */
    spansYears: boolean;
  };
};
