import { z } from "zod";
import { objectId, requiredText } from "@/lib/zod";

/** Validation shared by the team dialogs (client) and the actions (server). Client-safe. */

/** A role key: "admin", "member" or a custom role's key. The server checks that it exists. */
const roleKey = z.string({ error: "Pick a role" }).trim().toLowerCase().min(1, "Pick a role").max(40);

const password = z.string({ error: "Enter a password" }).min(8, "Use at least 8 characters").max(128, "At most 128 characters");

export const teamMemberSchema = z.object({
  name: requiredText("Name", 120),
  email: z.string({ error: "Enter an email address" }).trim().toLowerCase().max(200).pipe(z.email({ error: "Enter a valid email address" })),
  password,
  role: roleKey,
});

export type TeamMemberInput = z.input<typeof teamMemberSchema>;
export type TeamMemberValues = z.output<typeof teamMemberSchema>;

export const changeRoleSchema = z.object({ userId: objectId, role: roleKey });
export type ChangeRoleInput = z.input<typeof changeRoleSchema>;

export const renameMemberSchema = z.object({ userId: objectId, name: requiredText("Name", 120) });
export type RenameMemberInput = z.input<typeof renameMemberSchema>;
export type RenameMemberValues = z.output<typeof renameMemberSchema>;

export const setPasswordSchema = z
  .object({
    userId: objectId,
    password,
    confirm: z.string({ error: "Enter the password again" }),
    signOutOthers: z.boolean(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords do not match" });
export type SetPasswordInput = z.input<typeof setPasswordSchema>;
export type SetPasswordValues = z.output<typeof setPasswordSchema>;
