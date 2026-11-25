import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { ATTENDANCE_STATUS_VALUES, TIME_PATTERN } from "@/features/hr/constants";

/**
 * One attendance mark: an employee on one day. HR marks it on the daily sheet, or a leave record
 * writes it for each day of the leave. A day with no mark is "not marked".
 * `date` is IST midnight of the day (fromDateInput). Times are "HH:mm" India time; an out time
 * before the in time ends on the next day (a night shift).
 */
const attendanceSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUS_VALUES, required: true },
    /** The leave type code (HR rules) for a leave day, or for the other half of a half day. */
    leaveType: { type: String, trim: true, uppercase: true, maxlength: 12 },
    inTime: { type: String, match: TIME_PATTERN },
    outTime: { type: String, match: TIME_PATTERN },
    notes: { type: String, trim: true, maxlength: 500 },
    /** Marks written together by one leave record share this id, so the leave lists and deletes as one. */
    leaveBatch: { type: String, maxlength: 40 },
    markedBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ leaveBatch: 1 }, { partialFilterExpression: { leaveBatch: { $type: "string" } } });

export type AttendanceDoc = InferSchemaType<typeof attendanceSchema> & { _id: Types.ObjectId };
export const Attendance: Model<AttendanceDoc> = models.Attendance ?? model<AttendanceDoc>("Attendance", attendanceSchema, "attendance");
