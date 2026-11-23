import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/** Money moved between two of the company's own accounts (bank to cash, one bank to another). Neither income nor expense. */
const accountTransferSchema = new Schema(
  {
    from: { type: Schema.Types.ObjectId, ref: "BankAccount", required: true },
    to: { type: Schema.Types.ObjectId, ref: "BankAccount", required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, index: true },
    reference: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 1000 },
    /** The statement lines it was matched to, one per side. */
    bankTransactions: [{ type: Schema.Types.ObjectId, ref: "BankTransaction" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type AccountTransferDoc = InferSchemaType<typeof accountTransferSchema> & { _id: Types.ObjectId };
export const AccountTransfer: Model<AccountTransferDoc> =
  models.AccountTransfer ?? model<AccountTransferDoc>("AccountTransfer", accountTransferSchema, "accountTransfers");
