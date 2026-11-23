import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { INVESTMENT_TYPES, valuesOf } from "@/lib/constants";

/** A long-term investment. Carried at cost on the balance sheet; `currentValue` is shown beside it. */
const investmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    type: { type: String, enum: valuesOf(INVESTMENT_TYPES), default: "other" },
    /** long_term_investments or a subgroup id under it. */
    group: { type: String, required: true, default: "long_term_investments", maxlength: 80 },
    institution: { type: String, trim: true, maxlength: 160 },
    reference: { type: String, trim: true, maxlength: 120 },
    purchaseDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    /** Paid from; missing = held before the books started (opening balance). */
    account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    currentValue: { type: Number, min: 0 },
    valuedOn: { type: Date },
    interestRate: { type: Number, min: 0, max: 100 },
    maturityDate: { type: Date },
    redemption: {
      type: new Schema(
        {
          date: { type: Date, required: true },
          amount: { type: Number, required: true, min: 0 },
          account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
          notes: { type: String, trim: true, maxlength: 1000 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    notes: { type: String, trim: true, maxlength: 2000 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type InvestmentDoc = InferSchemaType<typeof investmentSchema> & { _id: Types.ObjectId };
export const Investment: Model<InvestmentDoc> = models.Investment ?? model<InvestmentDoc>("Investment", investmentSchema, "investments");
