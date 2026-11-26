import "server-only";

import { connectDB } from "@/server/db";
import { Role, User } from "@/server/models";
import { roleKeyOf } from "@/server/auth/permissions";
import { ADMIN_ROLE, ALL_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS, MEMBER_ROLE, storedRolePermissions } from "@/lib/permissions";
import type { RoleSummary } from "./model";

/** Who holds each role key, by name. */
async function peopleByRole(): Promise<Map<string, { id: string; name: string }[]>> {
  const users = await User.find({}, { name: 1, email: 1, role: 1 }).sort({ name: 1 }).lean();
  const by = new Map<string, { id: string; name: string }[]>();
  for (const u of users) {
    const key = roleKeyOf(u.role);
    const list = by.get(key) ?? [];
    list.push({ id: String(u._id), name: u.name ?? u.email ?? "Unknown" });
    by.set(key, list);
  }
  return by;
}

/** Admin, Member, then the custom roles by name, each with the people who hold it. */
export async function listRoles(): Promise<RoleSummary[]> {
  await connectDB();
  const [docs, people] = await Promise.all([Role.find({}).sort({ name: 1 }).lean(), peopleByRole()]);
  const memberDoc = docs.find((d) => d.key === MEMBER_ROLE);
  const roles: RoleSummary[] = [
    {
      key: ADMIN_ROLE,
      name: "Admin",
      description: "Every permission, always. Admins also manage other admins.",
      builtIn: true,
      locked: true,
      isDefault: true,
      permissions: [...ALL_PERMISSIONS],
      people: people.get(ADMIN_ROLE) ?? [],
    },
    {
      key: MEMBER_ROLE,
      name: "Member",
      description: memberDoc?.description || "The standard role for the team.",
      builtIn: true,
      locked: false,
      isDefault: !memberDoc,
      permissions: memberDoc ? storedRolePermissions(memberDoc.permissions, memberDoc.denied) : [...MEMBER_DEFAULT_PERMISSIONS],
      people: people.get(MEMBER_ROLE) ?? [],
    },
  ];
  for (const d of docs) {
    if (d.key === ADMIN_ROLE || d.key === MEMBER_ROLE) continue;
    roles.push({
      key: d.key,
      name: d.name,
      description: d.description ?? "",
      builtIn: false,
      locked: false,
      isDefault: false,
      permissions: storedRolePermissions(d.permissions, d.denied),
      people: people.get(d.key) ?? [],
    });
  }
  return roles;
}

export async function getRole(key: string): Promise<RoleSummary | null> {
  const k = roleKeyOf(key);
  return (await listRoles()).find((r) => r.key === k) ?? null;
}

/** The names of roles by key, for the team list. Keys with no role are left out (shown as "Role missing"). */
export async function roleNames(): Promise<Record<string, string>> {
  return Object.fromEntries((await listRoles()).map((r) => [r.key, r.name]));
}
