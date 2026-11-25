import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * A bonus or deduction for one person in one month ("2026-11"), added on the salary page.
 * It changes the salary worked out from attendance; it does not touch Expenses.
 */
const payrollAdjustmentSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    additions: { type: Number, min: 0, default: 0 },
    deductions: { type: Number, min: 0, default: 0 },
    note: { type: String, trim: true, maxlength: 300 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
payrollAdjustmentSchema.index({ employee: 1, month: 1 }, { unique: true });
payrollAdjustmentSchema.index({ month: 1 });

export type PayrollAdjustmentDoc = InferSchemaType<typeof payrollAdjustmentSchema> & { _id: Types.ObjectId };
export const PayrollAdjustment: Model<PayrollAdjustmentDoc> =
  models.PayrollAdjustment ?? model<PayrollAdjustmentDoc>("PayrollAdjustment", payrollAdjustmentSchema, "payrollAdjustments");

/**
 * A month whose salary from attendance was finalised: the salary lines as they were then
 * (src/features/hr/salary/calc.ts SalaryLine), so later changes to rules or attendance do not
 * change them. While a month is finalised, its attendance, leave and adjustments are locked.
 * Reopening keeps the document with status "reopened"; finalising again replaces the lines.
 * Nothing here posts to Expenses: the salary schedules in Recurring still post the expenses.
 */
const payrollRunSchema = new Schema(
  {
    month: { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ["finalised", "reopened"], required: true },
    lines: { type: [Schema.Types.Mixed], default: [] },
    rules: { type: Schema.Types.Mixed },
    totals: { type: Schema.Types.Mixed },
    finalisedBy: { type: Schema.Types.ObjectId, ref: "User" },
    finalisedAt: { type: Date },
    reopenedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reopenedAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);

export type PayrollRunDoc = InferSchemaType<typeof payrollRunSchema> & { _id: Types.ObjectId };
export const PayrollRun: Model<PayrollRunDoc> = models.PayrollRun ?? model<PayrollRunDoc>("PayrollRun", payrollRunSchema, "payrollRuns");
