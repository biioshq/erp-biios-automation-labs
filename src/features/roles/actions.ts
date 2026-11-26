"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { Role, User } from "@/server/models";
import { AppError, notFound } from "@/server/errors";
import { resolveRole } from "@/server/auth/permissions";
import {
  ADMIN_ROLE,
  BUILT_IN_ROLES,
  DEFAULT_ON_PERMISSIONS,
  MEMBER_DEFAULT_PERMISSIONS,
  MEMBER_ROLE,
  deniedDefaults,
  normalizePermissions,
} from "@/lib/permissions";
import { createRoleSchema, renameRoleSchema, roleKeySchema, rolePermissionsSchema } from "./schemas";
import { assertMayEditRole, assertMayGrant } from "./rules";
import { missingFrom, slugify } from "./model";

// Permissions decide what every page shows, so a change refreshes the whole app.
const REVALIDATE: [string, "layout"][] = [["/", "layout"]];

/** A free key for a new role, from its name. "admin" and "member" are reserved. */
async function freeKey(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 1; i < 200; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    if ((BUILT_IN_ROLES as readonly string[]).includes(key)) continue;
    // A key some people still hold (from a deleted role) is not reused: they would get this role.
    if (!(await Role.exists({ key })) && !(await User.exists({ role: key }))) return key;
  }
  throw new AppError("Could not find a free name for this role. Try another name.", "conflict");
}

/** Role names are unique, ignoring case, and "Admin" and "Member" belong to the built-in roles. */
async function assertNameFree(name: string, exceptKey?: string) {
  const reserved = ["admin", "member"].includes(name.trim().toLowerCase());
  const clash = await Role.findOne({ name: name.trim() }, { key: 1 }).collation({ locale: "en", strength: 2 }).lean();
  if (reserved || (clash && clash.key !== exceptKey)) {
    throw new AppError("A role with this name already exists.", "conflict", { name: ["Already in use"] });
  }
}

export const createRole = defineAction(
  createRoleSchema,
  async (input, user) => {
    await assertNameFree(input.name);
    // An empty role still starts with the default-on permissions (such as "Change own password")
    // that the creator may give; a copy takes the source role's state, ticked or not.
    let permissions: string[] = DEFAULT_ON_PERMISSIONS.filter((p) => user.isAdmin || user.permissions.includes(p));
    if (input.copyFrom) {
      const source = await resolveRole(input.copyFrom);
      if (!source.exists) throw new AppError("The role to start from no longer exists.", "not_found");
      permissions = source.permissions;
    }
    permissions = normalizePermissions(permissions);
    assertMayGrant(user, permissions);
    const key = await freeKey(input.name);
    const actor = new Types.ObjectId(user.id);
    await Role.create({
      key,
      name: input.name,
      description: input.description,
      permissions,
      denied: deniedDefaults(permissions),
      builtIn: false,
      createdBy: actor,
      updatedBy: actor,
    });
    return { key };
  },
  { permission: "settings.roles:edit", revalidate: REVALIDATE, message: "Role created" },
);

export const renameRole = defineAction(
  renameRoleSchema,
  async (input, user) => {
    if ((BUILT_IN_ROLES as readonly string[]).includes(input.key)) throw new AppError("Built-in roles keep their names.", "invalid");
    assertMayEditRole(user, input.key);
    await assertNameFree(input.name, input.key);
    const res = await Role.updateOne(
      { key: input.key },
      { $set: { name: input.name, description: input.description, updatedBy: new Types.ObjectId(user.id) } },
    );
    if (!res.matchedCount) throw notFound("The role");
    return { key: input.key };
  },
  { permission: "settings.roles:edit", revalidate: REVALIDATE, message: "Role updated" },
);

export const saveRolePermissions = defineAction(
  rolePermissionsSchema,
  async (input, user) => {
    assertMayEditRole(user, input.key);
    const current = await resolveRole(input.key);
    if (!current.exists) throw notFound("The role");
    const permissions = normalizePermissions(input.permissions);
    assertMayGrant(user, missingFrom(current.permissions, permissions));
    const actor = new Types.ObjectId(user.id);
    // A default-on permission left unticked is stored in `denied`; ticking it again clears it.
    const denied = deniedDefaults(permissions);
    if (input.key === MEMBER_ROLE) {
      // Editing Member stores an override; "Reset to default" removes it.
      await Role.updateOne(
        { key: MEMBER_ROLE },
        { $set: { permissions, denied, updatedBy: actor }, $setOnInsert: { name: "Member", builtIn: true, description: "", createdBy: actor } },
        { upsert: true },
      );
    } else {
      await Role.updateOne({ key: input.key }, { $set: { permissions, denied, updatedBy: actor } });
    }
    return { key: input.key, count: permissions.length };
  },
  { permission: "settings.roles:edit", revalidate: REVALIDATE, message: "Permissions saved" },
);

export const resetMemberRole = defineAction(
  roleKeySchema,
  async (input, user) => {
    if (input.key !== MEMBER_ROLE) throw new AppError("Only the Member role has a default to go back to.", "invalid");
    assertMayEditRole(user, MEMBER_ROLE);
    const current = await resolveRole(MEMBER_ROLE);
    assertMayGrant(user, missingFrom(current.permissions, MEMBER_DEFAULT_PERMISSIONS));
    await Role.deleteOne({ key: MEMBER_ROLE });
    return { key: MEMBER_ROLE };
  },
  { permission: "settings.roles:edit", revalidate: REVALIDATE, message: "Member is back to its default permissions" },
);

export const duplicateRole = defineAction(
  roleKeySchema,
  async (input, user) => {
    const source = await resolveRole(input.key);
    if (!source.exists) throw notFound("The role");
    assertMayGrant(user, source.permissions);
    let name = `Copy of ${source.name}`;
    for (let i = 2; await Role.exists({ name }).collation({ locale: "en", strength: 2 }); i++) name = `Copy of ${source.name} (${i})`;
    const key = await freeKey(name);
    const actor = new Types.ObjectId(user.id);
    await Role.create({
      key,
      name,
      description: "",
      permissions: source.permissions,
      denied: deniedDefaults(source.permissions),
      builtIn: false,
      createdBy: actor,
      updatedBy: actor,
    });
    return { key };
  },
  { permission: "settings.roles:edit", revalidate: REVALIDATE, message: "Role copied" },
);

export const deleteRole = defineAction(
  roleKeySchema,
  async (input, user) => {
    if (input.key === ADMIN_ROLE || input.key === MEMBER_ROLE) throw new AppError("Built-in roles cannot be deleted.", "invalid");
    assertMayEditRole(user, input.key);
    const holders = await User.find({ role: input.key }, { name: 1, email: 1 }).sort({ name: 1 }).limit(6).lean();
    if (holders.length) {
      const names = holders.slice(0, 5).map((h) => h.name ?? h.email ?? "Unknown");
      const more = holders.length > 5 ? " and others" : "";
      throw new AppError(`People still have this role: ${names.join(", ")}${more}. Give them another role first.`, "conflict");
    }
    const res = await Role.deleteOne({ key: input.key });
    if (!res.deletedCount) throw notFound("The role");
    return { key: input.key };
  },
  { permission: "settings.roles:edit", revalidate: REVALIDATE, message: "Role deleted" },
);
