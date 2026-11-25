import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/** A company holiday: paid, and not a working day. `date` is IST midnight of the day. */
const hrHolidaySchema = new Schema(
  {
    date: { type: Date, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type HrHolidayDoc = InferSchemaType<typeof hrHolidaySchema> & { _id: Types.ObjectId };
export const HrHoliday: Model<HrHolidayDoc> = models.HrHoliday ?? model<HrHolidayDoc>("HrHoliday", hrHolidaySchema, "hrHolidays");
