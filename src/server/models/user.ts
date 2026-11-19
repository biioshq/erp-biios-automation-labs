import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Read-only view of Better Auth's `user` collection, so other documents can
 * `populate()` their user references. Better Auth owns writes to it.
 */
const userSchema = new Schema(
  {
    name: String,
    email: String,
    image: String,
    role: { type: String, default: "member" },
    emailVerified: Boolean,
    createdAt: Date,
    updatedAt: Date,
  },
  { collection: "user", strict: false, versionKey: false },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User: Model<UserDoc> = models.User ?? model<UserDoc>("User", userSchema);
