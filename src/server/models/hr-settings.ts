import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * The attendance rules (src/features/hr/constants.ts HrRules), one document with key "default".
 * There is none until someone saves the rules; until then DEFAULT_HR_RULES apply.
 * `rules` is kept as one object and checked by Zod before every save.
 */
const hrSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    rules: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, minimize: false },
);

export type HrSettingsDoc = InferSchemaType<typeof hrSettingsSchema> & { _id: Types.ObjectId };
export const HrSettings: Model<HrSettingsDoc> = models.HrSettings ?? model<HrSettingsDoc>("HrSettings", hrSettingsSchema, "hrSettings");
