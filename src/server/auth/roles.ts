import "server-only";

import { connectDB } from "@/server/db";
import { Role } from "@/server/models";
import { ADMIN_ROLE, ALL_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS, MEMBER_ROLE, OWN_PASSWORD_PERMISSION, storedRolePermissions } from "@/lib/permissions";

/**
 * Role resolution. It does not import the Better Auth instance, so auth.ts can use it in its hooks
 * without an import cycle. permissions.ts re-exports everything here.
 */

/** A role as the app applies it right now. */
export type ResolvedRole = {
  key: string;
  name: string;
  permissions: string[];
  /** False when a person holds a role key that has no role (deleted, or never created). */
  exists: boolean;
  builtIn: boolean;
};

/**
 * The role key a user document holds. Accounts from before roles existed hold "admin" or "member";
 * a missing or empty value is "member". Only the exact value "admin" is the Admin role (as before
 * roles existed), so a stray "Admin" never gains full access.
 */
export function roleKeyOf(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : MEMBER_ROLE;
}

/**
 * The permissions of a role, read fresh from the database (no cache across requests, so a change
 * applies on the next request).
 * - admin: every permission, always. A stored "admin" document is ignored.
 * - member: the catalogue defaults, or the stored Member document once an admin has edited it.
 * - any other key: the stored custom role; a key with no role gets Member access (as before roles).
 * A stored document also grants the default-on permissions it does not deny (storedRolePermissions).
 */
export async function resolveRole(rawKey: unknown): Promise<ResolvedRole> {
  const key = roleKeyOf(rawKey);
  if (key === ADMIN_ROLE) return { key, name: "Admin", permissions: [...ALL_PERMISSIONS], exists: true, builtIn: true };
  await connectDB();
  const doc = await Role.findOne({ key }, { name: 1, permissions: 1, denied: 1 }).lean();
  if (key === MEMBER_ROLE) {
    return {
      key,
      name: "Member",
      permissions: doc ? storedRolePermissions(doc.permissions, doc.denied) : [...MEMBER_DEFAULT_PERMISSIONS],
      exists: true,
      builtIn: true,
    };
  }
  // A key with no role (a value written outside the app, or a role removed by hand) keeps member
  // access, as any value other than "admin" did before roles existed. The team page flags it.
  if (!doc) return { key, name: "Role missing", permissions: (await resolveRole(MEMBER_ROLE)).permissions, exists: false, builtIn: false };
  return { key, name: doc.name, permissions: storedRolePermissions(doc.permissions, doc.denied), exists: true, builtIn: false };
}

/** True when people with this role key may change their own password (Admin always may). */
export async function roleMayChangeOwnPassword(rawKey: unknown): Promise<boolean> {
  return (await resolveRole(rawKey)).permissions.includes(OWN_PASSWORD_PERMISSION);
}
