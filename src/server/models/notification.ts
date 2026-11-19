import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

export const NOTIFICATION_TYPES = ["low_stock", "out_of_stock", "task_assigned", "task_comment", "system"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** In-app notifications. `user` null means everyone on the team sees it. */
const notificationSchema = new Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: ["info", "success", "warning", "danger"], default: "info" },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, maxlength: 1000 },
    href: { type: String },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    entity: { type: { type: String }, id: { type: Schema.Types.ObjectId } },
    /** Users who have read it. */
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);
notificationSchema.index({ createdAt: -1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & { _id: Types.ObjectId };
export const Notification: Model<NotificationDoc> =
  models.Notification ?? model<NotificationDoc>("Notification", notificationSchema, "notifications");
