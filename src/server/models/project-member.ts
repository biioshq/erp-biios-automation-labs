import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Who works on which project. One document per employee per project; ending a
 * membership keeps the history (endDate) instead of deleting it.
 */
const projectMemberSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    /** Role on this project, e.g. Project lead, Installer, Firmware. */
    role: { type: String, trim: true, maxlength: 80, default: "Team member" },
    /** Share of the person's time on this project, 1–100. */
    allocation: { type: Number, min: 0, max: 100, default: 100 },
    startDate: { type: Date },
    endDate: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
// One open membership per person per project.
projectMemberSchema.index({ project: 1, employee: 1 }, { unique: true, partialFilterExpression: { endDate: null } });
projectMemberSchema.index({ employee: 1, endDate: 1 });

export type ProjectMemberDoc = InferSchemaType<typeof projectMemberSchema> & { _id: Types.ObjectId };
export const ProjectMember: Model<ProjectMemberDoc> =
  models.ProjectMember ?? model<ProjectMemberDoc>("ProjectMember", projectMemberSchema, "projectMembers");
