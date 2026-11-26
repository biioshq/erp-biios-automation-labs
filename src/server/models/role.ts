import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Roles people can be given (src/server/auth/permissions.ts reads them).
 * - "admin" is built in and never stored: it always has every permission.
 * - "member" is built in: with no document it has the catalogue's member defaults; a document
 *   with key "member" (builtIn true) is an admin's edit of it, and deleting it resets Member.
 * - Any other key is a custom role. People store the key in user.role.
 */
const roleSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    permissions: { type: [String], default: [] },
    /**
     * Default-on permissions (DEFAULT_ON_PERMISSIONS, for example "Change own password") that this
     * role has unticked. Absent on roles saved before it existed: they hold every default-on one.
     */
    denied: { type: [String], default: undefined },
    builtIn: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type RoleDoc = InferSchemaType<typeof roleSchema> & { _id: Types.ObjectId };
export const Role: Model<RoleDoc> = models.Role ?? model<RoleDoc>("Role", roleSchema, "roles");
