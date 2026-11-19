import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { AppError } from "@/server/errors";
import type { UserRole } from "@/lib/constants";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: UserRole;
};

/** The signed-in user for this request, or null. Deduplicated per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    role: (u.role === "admin" ? "admin" : "member") as UserRole,
  };
});

/** For pages and layouts: redirects to sign-in when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function assertUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Your session has expired. Sign in again.", "unauthorized");
  return user;
}

export async function assertAdmin(): Promise<SessionUser> {
  const user = await assertUser();
  if (user.role !== "admin") throw new AppError("Only an admin can do this.", "forbidden");
  return user;
}

/**
 * Per-person pay is admin-only: members never receive individual salary expenses or
 * salary schedules (company totals on dashboards still include them).
 */
export async function canSeeSalaries(): Promise<boolean> {
  return (await getCurrentUser())?.role === "admin";
}

/** Mongo condition that hides salary rows from members; empty for admins. */
export async function salaryScope(): Promise<Record<string, unknown>> {
  return (await canSeeSalaries()) ? {} : { category: { $ne: "salaries" } };
}
