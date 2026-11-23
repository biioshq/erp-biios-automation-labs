import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { BANK_LINE_ACTIONS, valuesOf } from "@/lib/constants";

/** One uploaded statement file: which account, which period, how many lines were added. */
const bankStatementSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "BankAccount", required: true, index: true },
    fileName: { type: String, trim: true, maxlength: 260 },
    from: { type: Date },
    to: { type: Date },
    openingBalance: { type: Number },
    closingBalance: { type: Number },
    lines: { type: Number, default: 0 },
    added: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    ignored: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type BankStatementDoc = InferSchemaType<typeof bankStatementSchema> & { _id: Types.ObjectId };
export const BankStatement: Model<BankStatementDoc> =
  models.BankStatement ?? model<BankStatementDoc>("BankStatement", bankStatementSchema, "bankStatements");

/**
 * One statement line once it was dealt with: matched to a record that already existed, turned
 * into a new one, or ignored. `hash` (account, date, amount, narration, balance) is unique per
 * account, so uploading the same statement twice adds nothing.
 */
const bankTransactionSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "BankAccount", required: true },
    statement: { type: Schema.Types.ObjectId, ref: "BankStatement", index: true },
    hash: { type: String, required: true },
    date: { type: Date, required: true, index: true },
    narration: { type: String, trim: true, maxlength: 1000 },
    reference: { type: String, trim: true, maxlength: 120 },
    withdrawal: { type: Number, min: 0, default: 0 },
    deposit: { type: Number, min: 0, default: 0 },
    balance: { type: Number },
    action: { type: String, enum: valuesOf(BANK_LINE_ACTIONS), required: true },
    /** The record it is: expense, income, capitalEntry, liability, liabilityPayment, accountTransfer. */
    link: {
      type: new Schema({ kind: { type: String, required: true }, id: { type: Schema.Types.ObjectId, required: true } }, { _id: false }),
      default: undefined,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
bankTransactionSchema.index({ account: 1, hash: 1 }, { unique: true });
bankTransactionSchema.index({ "link.kind": 1, "link.id": 1 });

export type BankTransactionDoc = InferSchemaType<typeof bankTransactionSchema> & { _id: Types.ObjectId };
export const BankTransaction: Model<BankTransactionDoc> =
  models.BankTransaction ?? model<BankTransactionDoc>("BankTransaction", bankTransactionSchema, "bankTransactions");
