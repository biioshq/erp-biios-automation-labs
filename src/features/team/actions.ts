"use server";

import { defineAction } from "@/server/action";
import { assertAdmin } from "@/server/auth/session";
import { createTeamMember } from "@/server/services/users";
import { teamMemberSchema } from "./schemas";

export const addTeamMember = defineAction(
  teamMemberSchema,
  async (input) => {
    await assertAdmin();
    const user = await createTeamMember(input);
    return { id: String(user.id) };
  },
  { revalidate: [["/settings", "layout"], ["/tasks", "layout"]], message: "Team member added" },
);
