import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { TASK_PRIORITIES, TASK_STATUSES, valuesOf } from "@/lib/constants";

const commentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true },
);

/** "Overdue" is derived: dueDate before today (IST) and status not completed/cancelled. */
const taskSchema = new Schema(
  {
    /** TSK-0042 */
    number: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 10000 },
    project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    assignee: { type: Schema.Types.ObjectId, ref: "User", index: true },
    priority: { type: String, enum: valuesOf(TASK_PRIORITIES), default: "medium" },
    dueDate: { type: Date, index: true },
    status: { type: String, enum: valuesOf(TASK_STATUSES), default: "pending" },
    /** Position within its Kanban column (fractional indexing). */
    order: { type: Number, default: 0 },
    attachments: [{ type: Schema.Types.ObjectId, ref: "File" }],
    comments: { type: [commentSchema], default: [] },
    completedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
taskSchema.index({ status: 1, order: 1 });
taskSchema.index({ title: "text", description: "text", number: "text" });

export type TaskDoc = InferSchemaType<typeof taskSchema> & { _id: Types.ObjectId };
export const Task: Model<TaskDoc> = models.Task ?? model<TaskDoc>("Task", taskSchema, "tasks");
