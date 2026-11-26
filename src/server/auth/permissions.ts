import "server-only";

import { auth } from "./auth";
import { resolveRole } from "./roles";
import { ADMIN_ROLE } from "@/lib/permissions";

// Role resolution lives in roles.ts (no Better Auth import, so auth.ts hooks can use it).
export { resolveRole, roleKeyOf, roleMayChangeOwnPassword, type ResolvedRole } from "./roles";

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
