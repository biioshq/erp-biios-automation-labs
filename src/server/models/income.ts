import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { INCOME_CATEGORIES, PAYMENT_METHODS, valuesOf } from "@/lib/constants";

const incomeSchema = new Schema(
  {
    /** INC-2026-00012 */
    number: { type: String, required: true, unique: true },
    client: { type: String, required: true, trim: true, maxlength: 200 },
    project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    category: { type: String, enum: valuesOf(INCOME_CATEGORIES), default: "project_payment" },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, index: true },
    paymentMethod: { type: String, enum: valuesOf(PAYMENT_METHODS), required: true },
    /** UTR / transaction id / cheque number. */
    reference: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 4000 },
    receipt: { type: Schema.Types.ObjectId, ref: "File" },
    /** The invoice this payment settles (all or part of). */
    invoice: { type: Schema.Types.ObjectId, ref: "Invoice", index: true },
    /** The bank or cash account it came into; missing = the default for its method. */
    account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    /** The bank statement line it came from or was matched to. */
    bankTransaction: { type: Schema.Types.ObjectId, ref: "BankTransaction" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "income" },
);
incomeSchema.index({ client: 1 });
incomeSchema.index({ client: "text", notes: "text", number: "text", reference: "text" });

export type IncomeDoc = InferSchemaType<typeof incomeSchema> & { _id: Types.ObjectId };
export const Income: Model<IncomeDoc> = models.Income ?? model<IncomeDoc>("Income", incomeSchema, "income");
