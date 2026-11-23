import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { CAPITAL_ENTRY_TYPES, EQUITY_HOLDER_KINDS, INVESTOR_INSTRUMENTS, PAYMENT_METHODS, valuesOf } from "@/lib/constants";

/** An owner or investor. Each person or firm has one record; their contributions are capital entries. */
const equityHolderSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: valuesOf(EQUITY_HOLDER_KINDS), required: true, index: true },
    /** Share of ownership, where it applies. */
    ownershipPercent: { type: Number, min: 0, max: 100 },
    instrument: { type: String, enum: valuesOf(INVESTOR_INSTRUMENTS) },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 30 },
    notes: { type: String, trim: true, maxlength: 2000 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type EquityHolderDoc = InferSchemaType<typeof equityHolderSchema> & { _id: Types.ObjectId };
export const EquityHolder: Model<EquityHolderDoc> =
  models.EquityHolder ?? model<EquityHolderDoc>("EquityHolder", equityHolderSchema, "equityHolders");

/**
 * One movement of equity: capital introduced, a drawing, a dividend, a transfer to a reserve, or
 * the retained earnings the company had before the books started. Capital is never income and a
 * drawing is never an expense: the statements read these separately.
 */
const capitalEntrySchema = new Schema(
  {
    /** CAP-2627-00004 */
    number: { type: String, required: true, unique: true },
    type: { type: String, enum: valuesOf(CAPITAL_ENTRY_TYPES), required: true, index: true },
    holder: { type: Schema.Types.ObjectId, ref: "EquityHolder", index: true },
    date: { type: Date, required: true, index: true },
    /** Positive, except retained earnings before the books started, which is negative for accumulated losses. */
    amount: { type: Number, required: true },
    /** For capital: the first money this holder put in, or more later. */
    initial: { type: Boolean },
    instrument: { type: String, enum: valuesOf(INVESTOR_INSTRUMENTS) },
    /** Reserve transfers: general_reserve, other_reserves or a subgroup id. */
    reserveGroup: { type: String, trim: true, maxlength: 80 },
    paymentMethod: { type: String, enum: valuesOf(PAYMENT_METHODS) },
    account: { type: Schema.Types.ObjectId, ref: "BankAccount" },
    reference: { type: String, trim: true, maxlength: 120 },
    purpose: { type: String, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 4000 },
    documents: [{ type: Schema.Types.ObjectId, ref: "File" }],
    bankTransaction: { type: Schema.Types.ObjectId, ref: "BankTransaction" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type CapitalEntryDoc = InferSchemaType<typeof capitalEntrySchema> & { _id: Types.ObjectId };
export const CapitalEntry: Model<CapitalEntryDoc> =
  models.CapitalEntry ?? model<CapitalEntryDoc>("CapitalEntry", capitalEntrySchema, "capitalEntries");
