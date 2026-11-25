import { z } from "zod";
import { dateInput, objectId } from "@/lib/zod";

/** Validation for the leaves actions that the shared HR schemas do not cover. Client-safe. */

/** The dialog asks the server what a leave would record before it is saved. */
export const leavePreviewSchema = z
  .object({
    employeeId: objectId,
    leaveType: z.string().trim().toUpperCase().min(1, "Pick the leave type").max(12),
    from: dateInput,
    to: dateInput,
    halfDay: z.boolean().optional().default(false),
    skipOffDays: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: "custom", path: ["to"], message: "The last day is before the first day" });
    if (v.halfDay && v.from !== v.to) ctx.addIssue({ code: "custom", path: ["halfDay"], message: "A half day of leave is for one day only" });
    if ((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 > 366) ctx.addIssue({ code: "custom", path: ["to"], message: "At most a year at a time" });
  });
export type LeavePreviewInput = z.input<typeof leavePreviewSchema>;

/** The attendance mark ids of one leave run. */
export const deleteLeaveSchema = z.object({
  ids: z.array(objectId).min(1, "Nothing to delete").max(400, "Too many days at once"),
});
