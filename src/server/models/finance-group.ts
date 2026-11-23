import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * A subgroup an admin added under an asset, liability or equity group ("Solar equipment" under
 * Fixed assets, "Office chairs" under Furniture and fixtures). The built-in groups live in code
 * (src/lib/finance-groups.ts); `parent` is a built-in key or the id of another subgroup, so subgroups nest.
 * Records store the group key or the subgroup id, so renaming one changes nothing else.
 */
const financeGroupSchema = new Schema(
  {
    kind: { type: String, enum: ["asset", "liability", "equity"], required: true, index: true },
    parent: { type: String, required: true, trim: true, maxlength: 80, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500 },
    /** Anything else worth keeping with the group (policy, useful life it usually has, account codes). */
    details: { type: String, trim: true, maxlength: 2000 },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
financeGroupSchema.index({ parent: 1, name: 1 });

export type FinanceGroupDoc = InferSchemaType<typeof financeGroupSchema> & { _id: Types.ObjectId };
export const FinanceGroup: Model<FinanceGroupDoc> =
  models.FinanceGroup ?? model<FinanceGroupDoc>("FinanceGroup", financeGroupSchema, "financeGroups");
