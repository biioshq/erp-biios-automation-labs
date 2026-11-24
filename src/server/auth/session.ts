import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { sessionUserFromToken, type SessionUser } from "./permissions";
import { AppError } from "@/server/errors";
import { hasPermission } from "@/lib/permissions";

export type { SessionUser };

/**
 * The signed-in user for this request, or null. Deduplicated per request.
 * Better Auth's cookie cache only finds the session token; the session row, the user's role and
 * the role's permissions are then read from the database on every request, so a role change, a
 * permission change or a sign-out applies at once.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return sessionUserFromToken(session.session.token);
});

/** True when the person may do this. The built-in Admin role may do everything. */
export function can(user: SessionUser, permission: string): boolean {
  return user.isAdmin || hasPermission(user.permissions, permission);
}

/** For pages and layouts: redirects to sign-in when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/**
 * For pages: redirects to sign-in when there is no session. It does not redirect when the
 * permission is missing; the page checks can() and renders <NoAccess />:
 *
 *   const user = await requirePermission("finance.equity:view");
 *   if (!can(user, "finance.equity:view")) return <NoAccess title="Capital / Equity" />;
 */
export async function requirePermission(permission: string): Promise<SessionUser> {
  void permission;
  return requireUser();
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function assertUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Your session has expired. Sign in again.", "unauthorized");
  return user;
}

/**
 * For server actions and route handlers: the signed-in user when they hold the permission (with
 * a list, any one of them is enough); otherwise throws a "forbidden" AppError.
 */
export async function assertPermission(permission: string | string[]): Promise<SessionUser> {
  const user = await assertUser();
  const list = Array.isArray(permission) ? permission : [permission];
  if (!list.some((p) => can(user, p))) throw new AppError("You do not have permission to do this.", "forbidden");
  return user;
}

/** The built-in Admin role only. Use for protecting admin accounts, not as a feature gate. */
export async function assertAdmin(): Promise<SessionUser> {
  const user = await assertUser();
  if (!user.isAdmin) throw new AppError("Only an admin can do this.", "forbidden");
  return user;
}

/**
 * Per-person pay needs "data.salaries": without it, people never receive individual salary
 * expenses or salary schedules (company totals on dashboards still include them).
 */
export async function canSeeSalaries(): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? can(user, "data.salaries") : false;
}

/** Mongo condition that hides salary rows from people without "data.salaries"; empty for those with it. */
export async function salaryScope(): Promise<Record<string, unknown>> {
  return (await canSeeSalaries()) ? {} : { category: { $ne: "salaries" } };
}
