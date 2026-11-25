"use server";

import { defineAction } from "@/server/action";
import { createTeamMember, setUserName, setUserPassword, setUserRole } from "@/server/services/users";
import { changeRoleSchema, renameMemberSchema, setPasswordSchema, teamMemberSchema } from "./schemas";
import { AppError } from "@/server/errors";
import { assertKeepsAnAdmin, assertMayAssign, assertMayManage, assertMayRename, hasAnAdmin, loadTarget } from "./rules";

// A role change alters what that person's pages show; names show across the app.
const REVALIDATE: [string, "layout"][] = [["/", "layout"]];

export const addTeamMember = defineAction(
  teamMemberSchema,
  async (input, user) => {
    const role = await assertMayAssign(user, input.role);
    const created = await createTeamMember({ ...input, role: role.key }, user.id);
    return { id: String(created.id) };
  },
  { permission: "settings.team:create", revalidate: REVALIDATE, message: "Team member added" },
);

export const changeMemberRole = defineAction(
  changeRoleSchema,
  async (input, user) => {
    const target = await loadTarget(input.userId);
    await assertMayManage(user, target, "role");
    const role = await assertMayAssign(user, input.role);
    if (role.key === target.role) return { role: role.key, name: role.name };
    await assertKeepsAnAdmin(target, role.key);
    await setUserRole(target.id, role.key, user.id);
    // Two admins changing each other's role at the same moment could both pass the check above.
    if (!(await hasAnAdmin())) {
      await setUserRole(target.id, target.role, user.id);
      throw new AppError("There must always be at least one admin. Make someone else an admin first.", "conflict");
    }
    return { role: role.key, name: role.name };
  },
  { permission: "settings.team:edit", revalidate: REVALIDATE, message: "Role changed" },
);

export const renameMember = defineAction(
  renameMemberSchema,
  async (input, user) => {
    const target = await loadTarget(input.userId);
    assertMayRename(user, target);
    await setUserName(target.id, input.name, user.id);
    return { name: input.name };
  },
  { permission: "settings.team:edit", revalidate: REVALIDATE, message: "Name changed" },
);

/** Admins only: no role, however it is set up, can set another person's password. */
export const setMemberPassword = defineAction(
  setPasswordSchema,
  async (input, user) => {
    if (!user.isAdmin) throw new AppError("Only an admin can set a new password for someone.", "forbidden");
    const target = await loadTarget(input.userId);
    await assertMayManage(user, target, "password");
    const result = await setUserPassword(target.id, input.password, { signOut: input.signOutOthers, actorId: user.id });
    return { created: result.created, signedOut: input.signOutOthers };
  },
  { permission: "settings.team:edit", revalidate: REVALIDATE, message: "Password set" },
);
