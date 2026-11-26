import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import {
  PAYMENT_METHODS,
  PROJECT_STAGES,
  RECURRING_FREQUENCIES,
  RECURRING_STATUSES,
  valuesOf,
} from "@/lib/constants";

/**
 * A schedule that posts the same expense on a rhythm: salaries, rent, internet,
 * software subscriptions, AMC fees. The scheduler (src/server/services/recurring.ts)
 * creates one expense per due date, never twice (each expense carries a unique
 * occurrence key), and catches up on dates it missed while the server was down.
 */
const recurringExpenseSchema = new Schema(
  {
    /** RCR-0004 */
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    vendor: { type: String, required: true, trim: true, maxlength: 200 },
    /** A built-in value (EXPENSE_CATEGORIES) or a custom one (expenseCategories). The actions check it, not an enum, so custom values save. */
    category: { type: String, required: true },
    description: { type: String, trim: true, maxlength: 1000 },
    /** Amount per occurrence, GST included. */
    amount: { type: Number, required: true, min: 0 },
    /** When set, each posted expense records GST: taxable = amount / (1 + rate). */
    gstRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 0 },
    gstin: { type: String, uppercase: true, trim: true },
    hsnSac: { type: String, trim: true },
    paymentMethod: { type: String, enum: valuesOf(PAYMENT_METHODS), default: "bank_transfer" },
    project: { type: Schema.Types.ObjectId, ref: "Project" },
    stage: { type: String, enum: valuesOf(PROJECT_STAGES) },
    /** For salaries. */
    employee: { type: Schema.Types.ObjectId, ref: "Employee", index: true },

    frequency: { type: String, enum: valuesOf(RECURRING_FREQUENCIES), required: true, default: "monthly" },
    /** Day of the month for monthly and longer rhythms (1–28, or 31 for the last day). */
    dayOfMonth: { type: Number, min: 1, max: 31, default: 1 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    /** The next date an expense is due (IST midnight). */
    nextRunDate: { type: Date, required: true, index: true },
    lastRunDate: { type: Date },
    occurrences: { type: Number, default: 0 },
    status: { type: String, enum: valuesOf(RECURRING_STATUSES), default: "active", index: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    /**
     * Was the "Fixed commitment" switch. No longer shown or used: Fixed payments now lists one-off
     * purchases of goods. Kept so schedules that stored it still read as they did.
     */
    fixed: { type: Boolean },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
recurringExpenseSchema.index({ status: 1, nextRunDate: 1 });
recurringExpenseSchema.index({ name: "text", vendor: "text", code: "text" });

export type RecurringExpenseDoc = InferSchemaType<typeof recurringExpenseSchema> & { _id: Types.ObjectId };
export const RecurringExpense: Model<RecurringExpenseDoc> =
  models.RecurringExpense ?? model<RecurringExpenseDoc>("RecurringExpense", recurringExpenseSchema, "recurringExpenses");
