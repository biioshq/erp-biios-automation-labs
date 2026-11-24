import "server-only";

import { connectDB } from "@/server/db";
import { Role } from "@/server/models";
import { auth } from "./auth";
import { ADMIN_ROLE, ALL_PERMISSIONS, MEMBER_DEFAULT_PERMISSIONS, MEMBER_ROLE, normalizePermissions } from "@/lib/permissions";

/** The signed-in person as the server sees them for one request. session.ts re-exports it. */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** The role key: "admin", "member" or a custom role's key. */
  role: string;
  /** The role's name as people see it ("Role missing" when the role no longer exists). */
  roleName: string;
  /**
   * True for the built-in Admin role. Use it only to protect admin accounts (who may change an
   * admin's role or password); gate features with can() and a permission.
   */
  isAdmin: boolean;
  /** Everything this person may do, read fresh for this request. */
  permissions: string[];
};

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
 */
export async function resolveRole(rawKey: unknown): Promise<ResolvedRole> {
  const key = roleKeyOf(rawKey);
  if (key === ADMIN_ROLE) return { key, name: "Admin", permissions: [...ALL_PERMISSIONS], exists: true, builtIn: true };
  await connectDB();
  const doc = await Role.findOne({ key }, { name: 1, permissions: 1 }).lean();
  if (key === MEMBER_ROLE) {
    return {
      key,
      name: "Member",
      permissions: doc ? normalizePermissions(doc.permissions ?? []) : [...MEMBER_DEFAULT_PERMISSIONS],
      exists: true,
      builtIn: true,
    };
  }
  // A key with no role (a value written outside the app, or a role removed by hand) keeps member
  // access, as any value other than "admin" did before roles existed. The team page flags it.
  if (!doc) return { key, name: "Role missing", permissions: (await resolveRole(MEMBER_ROLE)).permissions, exists: false, builtIn: false };
  return { key, name: doc.name, permissions: normalizePermissions(doc.permissions ?? []), exists: true, builtIn: false };
}

/**
 * The person behind a session token, read fresh from the database: the session must still exist
 * and be unexpired (so "Sign them out of other devices" applies at once), and the role comes from
 * the user document as it is now (so a role change applies at once). null when the session is
 * gone or expired.
 *
 * session.ts calls this with the token from Better Auth's cookie-cached getSession. Reading the
 * session with disableCookieCache instead would make Better Auth set its cache cookie on every
 * call, and a cookie set inside a server action makes Next.js re-render the whole current page.
 */
export async function sessionUserFromToken(token: string): Promise<SessionUser | null> {
  const ctx = await auth.$context;
  const fresh = await ctx.internalAdapter.findSession(token);
  if (!fresh || !(new Date(fresh.session.expiresAt).getTime() > Date.now())) return null;
  const u = fresh.user as typeof fresh.user & { role?: unknown };
  const role = await resolveRole(u.role);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    role: role.key,
    roleName: role.name,
    isAdmin: role.key === ADMIN_ROLE,
    permissions: role.permissions,
  };
}
