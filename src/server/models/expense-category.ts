import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Expense category settings (src/lib/expense-categories.ts merges them with the built-in list):
 * - a custom category an admin added (value "c_...", never changes once created), or
 * - a rename or hide of a built-in category (value is the built-in value).
 * Expenses and recurring schedules store the value, so nothing else changes when a label does.
 */
const expenseCategorySchema = new Schema(
  {
    value: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
    label: { type: String, trim: true, maxlength: 60 },
    hidden: { type: Boolean, default: false },
    builtIn: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type ExpenseCategorySettingDoc = InferSchemaType<typeof expenseCategorySchema> & { _id: Types.ObjectId };
/** Named "...Setting" because ExpenseCategory is already the type of a built-in value in constants. */
export const ExpenseCategorySetting: Model<ExpenseCategorySettingDoc> =
  models.ExpenseCategorySetting ??
  model<ExpenseCategorySettingDoc>("ExpenseCategorySetting", expenseCategorySchema, "expenseCategories");
