import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { BANK_ACCOUNT_KINDS, valuesOf } from "@/lib/constants";

/**
 * A bank account or a cash box the company pays from and into. Its balance is never stored: it is
 * the opening balance plus every receipt and payment tied to it (src/server/accounting). Records
 * without an account use the default account for their payment method (`defaultFor`).
 */
const bankAccountSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: valuesOf(BANK_ACCOUNT_KINDS), required: true, default: "bank" },
    bankName: { type: String, trim: true, maxlength: 120 },
    /** Last four digits only; the full number is never stored. */
    accountLast4: { type: String, trim: true, maxlength: 4 },
    ifsc: { type: String, trim: true, uppercase: true, maxlength: 11 },
    /** Balance on `openingDate` (IST midnight). Negative for an overdraft. */
    openingBalance: { type: Number, default: 0 },
    openingDate: { type: Date, required: true },
    /**
     * Payment methods whose records land here when they name no account ("cash" for the cash box;
     * bank_transfer, upi, card, cheque for the main bank). At most one account per method (the actions keep that).
     */
    defaultFor: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type BankAccountDoc = InferSchemaType<typeof bankAccountSchema> & { _id: Types.ObjectId };
export const BankAccount: Model<BankAccountDoc> = models.BankAccount ?? model<BankAccountDoc>("BankAccount", bankAccountSchema, "bankAccounts");
