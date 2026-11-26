import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { PROJECT_STAGES, valuesOf } from "@/lib/constants";

/**
 * A party the bank statement review remembers (collection bankPartyRules): who a name on the
 * statement is, and what its lines were made into last time. Learned when statement lines are
 * added (src/features/finance/bank-statements/server/rules.ts) and edited on the Remembered
 * parties page. It only shapes suggestions; nothing is ever booked from a rule without review.
 *
 * `key` is the name as the statement shows it, in lower-case words (nameKey), or the UPI handle
 * when the line has no name. One rule per side and key: the unique index stops two uploads at the
 * same moment from making two rules for one name. `party` is the vendor or client it stands for.
 */
const bankPartyRuleSchema = new Schema(
  {
    /** "out" for withdrawals (vendors), "in" for deposits (payers). */
    side: { type: String, enum: ["in", "out"], required: true },
    key: { type: String, required: true, trim: true, maxlength: 200 },
    /** The UPI handle (name@bank) seen with this party, when there was one. */
    token: { type: String, trim: true, lowercase: true, maxlength: 120 },
    /** The vendor (out) or client (in) name the records use. */
    party: { type: String, required: true, trim: true, maxlength: 200 },
    /** Expense category value (out) or income category value (in). */
    category: { type: String, trim: true, maxlength: 80 },
    project: { type: Schema.Types.ObjectId, ref: "Project" },
    stage: { type: String, enum: valuesOf(PROJECT_STAGES) },
    /** How many added lines taught or used this rule. */
    hits: { type: Number, min: 0, default: 0 },
    lastUsedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
bankPartyRuleSchema.index({ side: 1, key: 1 }, { unique: true });
bankPartyRuleSchema.index({ side: 1, token: 1 });
bankPartyRuleSchema.index({ lastUsedAt: -1 });

export type BankPartyRuleDoc = InferSchemaType<typeof bankPartyRuleSchema> & { _id: Types.ObjectId };
export const BankPartyRule: Model<BankPartyRuleDoc> =
  models.BankPartyRule ?? model<BankPartyRuleDoc>("BankPartyRule", bankPartyRuleSchema, "bankPartyRules");
