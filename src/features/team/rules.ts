import "server-only";

import { Types } from "mongoose";
import { User } from "@/server/models";
import { AppError, notFound } from "@/server/errors";
import { resolveRole, roleKeyOf, type ResolvedRole } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/session";
import { ADMIN_ROLE } from "@/lib/permissions";
import { missingFrom } from "@/features/roles/model";

/**
 * The rules for managing people, checked on the server for every change:
 * - nobody changes their own role, or sets their own password here;
 * - only the built-in Admin role sets a new password for someone (setMemberPassword checks it first);
 * - only the built-in Admin role gives the Admin role, or changes an admin's role;
 * - someone who is not an admin cannot give a role, or manage a person whose role, can do
 *   anything their own role cannot;
 * - there is always at least one admin.
 */

export type Target = { id: string; name: string; role: string };

export async function loadTarget(userId: string): Promise<Target> {
  const u = await User.findById(new Types.ObjectId(userId), { name: 1, email: 1, role: 1 }).lean();
  if (!u) throw notFound("This person");
  return { id: String(u._id), name: u.name ?? u.email ?? "This person", role: roleKeyOf(u.role) };
}

/** The role exists and the actor may give it. */
export async function assertMayAssign(actor: SessionUser, roleKey: string): Promise<ResolvedRole> {
  const role = await resolveRole(roleKey);
  if (!role.exists) throw new AppError("That role does not exist. Pick another one.", "invalid", { role: ["Pick another role"] });
  if (role.key === ADMIN_ROLE && !actor.isAdmin) throw new AppError("Only an admin can give someone the Admin role.", "forbidden");
  if (!actor.isAdmin && missingFrom(actor.permissions, role.permissions).length) {
    throw new AppError("You can only give a role that does not go beyond your own role.", "forbidden", { role: ["Beyond your own role"] });
  }
  return role;
}

/** The actor may change this person's role or password (not only their name). */
export async function assertMayManage(actor: SessionUser, target: Target, what: "role" | "password") {
  if (actor.id === target.id) {
    throw new AppError(
      what === "role"
        ? "You cannot change your own role. Ask another admin."
        : "Use Change password in your account menu to change your own password.",
      "forbidden",
    );
  }
  if (target.role === ADMIN_ROLE && !actor.isAdmin) {
    throw new AppError(`Only an admin can change an admin's ${what}.`, "forbidden");
  }
  if (!actor.isAdmin) {
    const current = await resolveRole(target.role);
    if (missingFrom(actor.permissions, current.permissions).length) {
      throw new AppError(`${target.name}'s role goes beyond your own, so only an admin can change their ${what}.`, "forbidden");
    }
  }
}

/** An admin's name is changed only by an admin, like their role and password. */
export function assertMayRename(actor: SessionUser, target: Target) {
  if (target.role === ADMIN_ROLE && !actor.isAdmin && actor.id !== target.id) {
    throw new AppError("Only an admin can change an admin's name.", "forbidden");
  }
}

/** Refuses to take the Admin role from the last admin. */
export async function assertKeepsAnAdmin(target: Target, newRole: string) {
  if (target.role !== ADMIN_ROLE || newRole === ADMIN_ROLE) return;
  const admins = await User.countDocuments({ role: ADMIN_ROLE });
  if (admins <= 1) throw new AppError("There must always be at least one admin. Make someone else an admin first.", "conflict");
}

/** True while at least one person holds the Admin role. */
export async function hasAnAdmin(): Promise<boolean> {
  return Boolean(await User.exists({ role: ADMIN_ROLE }));
}
