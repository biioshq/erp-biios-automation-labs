import { z } from "zod";
import { requiredText } from "@/lib/zod";

/** Validation shared by the role dialogs (client) and the role actions (server). Client-safe. */

const roleKey = z.string().trim().toLowerCase().min(1).max(40);
const description = z.string().trim().max(300, "At most 300 characters").optional().default("");

export const createRoleSchema = z.object({
  name: requiredText("Name", 60),
  description,
  /** Start from this role's permissions; empty starts with none. */
  copyFrom: z.string().trim().toLowerCase().max(40).optional().default(""),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type CreateRoleValues = z.output<typeof createRoleSchema>;

export const renameRoleSchema = z.object({ key: roleKey, name: requiredText("Name", 60), description });
export type RenameRoleInput = z.input<typeof renameRoleSchema>;
export type RenameRoleValues = z.output<typeof renameRoleSchema>;

export const rolePermissionsSchema = z.object({ key: roleKey, permissions: z.array(z.string().max(80)).max(500) });
export type RolePermissionsInput = z.input<typeof rolePermissionsSchema>;

export const roleKeySchema = z.object({ key: roleKey });
