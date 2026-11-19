import { z } from "zod";
import { USER_ROLES, valuesOf } from "@/lib/constants";
import { requiredText } from "@/lib/zod";

/** Validation shared by the Add member dialog (client) and the action (server). Client-safe. */
export const teamMemberSchema = z.object({
  name: requiredText("Name", 120),
  email: z.string({ error: "Enter an email address" }).trim().toLowerCase().max(200).pipe(z.email({ error: "Enter a valid email address" })),
  password: z.string({ error: "Enter a temporary password" }).min(8, "Use at least 8 characters").max(128, "At most 128 characters"),
  role: z.enum(valuesOf(USER_ROLES), { error: "Pick a role" }),
});

export type TeamMemberInput = z.input<typeof teamMemberSchema>;
export type TeamMemberValues = z.output<typeof teamMemberSchema>;
