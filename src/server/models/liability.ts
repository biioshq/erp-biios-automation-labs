import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { LIABILITY_KINDS, LIABILITY_SOURCES, PAYMENT_METHODS, valuesOf } from "@/lib/constants";

/**
 * A repayment. The principal reduces what is owed; the interest is an expense, booked as its own
 * expense record (source "liability_interest", linked here) so it shows with every other expense.
 */
const liabilityPaymentSchema = new Schema(
  {
    date: { type: Date, required: true },
    principal: { type: Number, min: 0, default: 0 },
    interest: { type: Number, min: 0, default: 0 },
    paymentMethod: { type: String, enum: valuesOf(PAYMENT_METHODS), default: "bank_transfer" },
    account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    reference: { type: String, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 1000 },
    expense: { type: Schema.Types.ObjectId, ref: "Expense" },
    bankTransaction: { type: Schema.Types.ObjectId, ref: "BankTransaction" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

/**
 * Money the company owes that is not a supplier bill: bank and business loans, other borrowings,
 * taxes or salaries payable entered by hand, and any obligation in a subgroup an admin added.
 * Supplier bills are not stored here: unpaid expenses are the accounts payable. Balances and
 * status (paid, pending, overdue) are computed from the payments, never stored.
 */
const liabilitySchema = new Schema(
  {
    /** LIA-0003 */
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: valuesOf(LIABILITY_KINDS), default: "loan" },
    /** A built-in liability group key (short_term_loans, long_term_bank_loans...) or a subgroup id. */
    group: { type: String, required: true, trim: true, maxlength: 80, index: true },
    /** Bank, lender, supplier or authority owed. */
    lender: { type: String, required: true, trim: true, maxlength: 200 },
    originalAmount: { type: Number, required: true, min: 0 },
    /** The day it was taken on. */
    date: { type: Date, required: true },
    dueDate: { type: Date },
    /** Yearly, in percent. */
    interestRate: { type: Number, min: 0, max: 100 },
    tenureMonths: { type: Number, min: 0 },
    /** The usual instalment, for reminders. */
    installment: { type: Number, min: 0 },
    source: {
      type: new Schema(
        {
          mode: { type: String, enum: valuesOf(LIABILITY_SOURCES), required: true },
          account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
          paymentMethod: { type: String, enum: valuesOf(PAYMENT_METHODS) },
        },
        { _id: false },
      ),
      required: true,
    },
    payments: { type: [liabilityPaymentSchema], default: [] },
    reference: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 4000 },
    bankTransaction: { type: Schema.Types.ObjectId, ref: "BankTransaction" },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
liabilitySchema.index({ name: "text", lender: "text", code: "text", reference: "text" });

export type LiabilityDoc = InferSchemaType<typeof liabilitySchema> & { _id: Types.ObjectId };
export const Liability: Model<LiabilityDoc> = models.Liability ?? model<LiabilityDoc>("Liability", liabilitySchema, "liabilities");
