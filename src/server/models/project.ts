import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { PROJECT_STAGES, PROJECT_STATUSES, valuesOf } from "@/lib/constants";

const stageBudgetShape = Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, { type: Number, min: 0, default: 0 }]));

const projectSchema = new Schema(
  {
    /** PRJ-0007 */
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    client: { type: String, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 4000 },
    status: { type: String, enum: valuesOf(PROJECT_STATUSES), default: "planning", index: true },
    budget: { type: Number, required: true, min: 0, default: 0 },
    /** What the client pays for the whole project, when agreed. */
    contractValue: { type: Number, min: 0 },
    /**
     * Earlier budgets, oldest first, pushed whenever the budget changes. The first entry is the
     * original budget; missing on projects whose budget never changed (then the budget is both).
     */
    budgetHistory: {
      type: [
        new Schema(
          {
            budget: { type: Number, required: true, min: 0 },
            changedAt: { type: Date, required: true },
            changedBy: { type: Schema.Types.ObjectId, ref: "User" },
            note: { type: String, trim: true, maxlength: 500 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    /** Optional planned split of the budget across stages. */
    stageBudgets: { type: new Schema(stageBudgetShape, { _id: false }), default: () => ({}) },
    startDate: { type: Date },
    endDate: { type: Date },
    /** Accent for charts and chips. */
    color: { type: String, default: "#4a82cc" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
projectSchema.index({ name: "text", client: "text", code: "text", description: "text" });
projectSchema.index({ createdAt: -1 });

export type ProjectDoc = InferSchemaType<typeof projectSchema> & { _id: Types.ObjectId };
export const Project: Model<ProjectDoc> = models.Project ?? model<ProjectDoc>("Project", projectSchema, "projects");
