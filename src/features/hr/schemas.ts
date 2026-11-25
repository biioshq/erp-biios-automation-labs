import { z } from "zod";
import { dateInput, money, objectId, optionalText, requiredText } from "@/lib/zod";
import { ATTENDANCE_STATUS_VALUES, TIME_PATTERN, type HrRules } from "./constants";

/** Validation shared by the HR forms (client) and the HR actions (server). Client-safe. */

export const monthInput = z
  .string({ error: "Pick a month" })
  .regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/, "Pick a month");

const time = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .pipe(z.string().regex(TIME_PATTERN, "Use a time like 09:30").nullable());

const leaveCode = z
  .string()
  .trim()
  .toUpperCase()
  .max(12, "At most 12 characters")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** One row of the daily sheet. */
export const attendanceEntrySchema = z
  .object({
    employeeId: objectId,
    status: z.enum(ATTENDANCE_STATUS_VALUES, { error: "Pick a status" }),
    leaveType: leaveCode,
    inTime: time,
    outTime: time,
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.status === "leave" && !v.leaveType) ctx.addIssue({ code: "custom", path: ["leaveType"], message: "Pick the leave type" });
    if (v.outTime && !v.inTime) ctx.addIssue({ code: "custom", path: ["inTime"], message: "Enter the in time too" });
  });
export type AttendanceEntryInput = z.input<typeof attendanceEntrySchema>;
export type AttendanceEntryValues = z.output<typeof attendanceEntrySchema>;

/** Saves the daily sheet: the rows given are marked; employees left out are not touched. */
export const markDaySchema = z.object({
  date: dateInput,
  entries: z.array(attendanceEntrySchema).min(1, "Mark at least one person").max(1000),
});
export type MarkDayInput = z.input<typeof markDaySchema>;

/** Clears marks for a day (they go back to "not marked"). */
export const clearDaySchema = z.object({
  date: dateInput,
  employeeIds: z.array(objectId).min(1).max(1000),
});

/** Leave for one person over one day or a range of days. */
export const leaveFormSchema = z
  .object({
    employeeId: objectId,
    leaveType: z.string({ error: "Pick the leave type" }).trim().toUpperCase().min(1, "Pick the leave type").max(12),
    from: dateInput,
    to: dateInput,
    /** Only for a single day: half a day of leave, the other half worked. */
    halfDay: z.boolean().optional().default(false),
    /** Weekly offs and holidays inside the range are left out (true by default). */
    skipOffDays: z.boolean().optional().default(true),
    /** Replace marks that already exist on those days (otherwise the save stops and lists them). */
    overwrite: z.boolean().optional().default(false),
    reason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: "custom", path: ["to"], message: "The last day is before the first day" });
    if (v.halfDay && v.from !== v.to) ctx.addIssue({ code: "custom", path: ["halfDay"], message: "A half day of leave is for one day only" });
    const span = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
    if (span > 366) ctx.addIssue({ code: "custom", path: ["to"], message: "At most a year at a time" });
  });
export type LeaveFormInput = z.input<typeof leaveFormSchema>;
export type LeaveFormValues = z.output<typeof leaveFormSchema>;

export const holidaySchema = z.object({ date: dateInput, name: requiredText("Name", 80) });
export const holidayIdSchema = z.object({ id: objectId });

const leaveTypeSchema = z.object({
  code: z
    .string({ error: "Enter a code" })
    .trim()
    .toUpperCase()
    .min(1, "Enter a code")
    .max(12, "At most 12 characters")
    .regex(/^[A-Z0-9_-]+$/, "Letters and numbers only"),
  name: requiredText("Name", 60),
  paid: z.boolean(),
  yearlyQuota: z.number().min(0, "Cannot be negative").max(366, "At most 366 days").nullable(),
});

const hhmm = z.string().regex(TIME_PATTERN, "Use a time like 09:30");

export const hrRulesSchema = z
  .object({
    workStart: hhmm,
    workEnd: hhmm,
    graceMinutes: z.number({ error: "Enter a number" }).int("Whole minutes").min(0, "Cannot be negative").max(240, "At most 240 minutes"),
    fullDayHours: z.number({ error: "Enter a number" }).min(0.5, "At least half an hour").max(24, "At most 24 hours"),
    halfDayHours: z.number({ error: "Enter a number" }).min(0, "Cannot be negative").max(24, "At most 24 hours"),
    weeklyOffs: z.array(z.number().int().min(0).max(6)).max(6, "Leave at least one working day in the week"),
    offSaturdays: z.array(z.number().int().min(1).max(5)).max(5),
    salaryBasis: z.enum(["calendar_days", "fixed_30", "working_days"]),
    unmarkedDays: z.enum(["paid", "unpaid"]),
    lateMarksPerHalfDay: z.number({ error: "Enter a number" }).int("A whole number").min(0, "Cannot be negative").max(31, "At most 31"),
    overtimeRate: z.number({ error: "Enter a number" }).min(0, "Cannot be negative").max(5, "At most 5 times"),
    leaveTypes: z.array(leaveTypeSchema).max(20, "At most 20 leave types"),
    leaveYearStartMonth: z.number({ error: "Pick a month" }).int().min(1).max(12),
  })
  .superRefine((v, ctx) => {
    if (v.halfDayHours > v.fullDayHours) ctx.addIssue({ code: "custom", path: ["halfDayHours"], message: "More than a full day" });
    const codes = v.leaveTypes.map((t) => t.code);
    codes.forEach((c, i) => {
      if (codes.indexOf(c) !== i) ctx.addIssue({ code: "custom", path: ["leaveTypes", i, "code"], message: "Each code once" });
    });
  }) satisfies z.ZodType<HrRules>;
export type HrRulesInput = z.input<typeof hrRulesSchema>;

export const adjustmentSchema = z.object({
  employeeId: objectId,
  month: monthInput,
  additions: money,
  deductions: money,
  note: optionalText(300),
});
export type AdjustmentInput = z.input<typeof adjustmentSchema>;

export const monthSchema = z.object({ month: monthInput });
