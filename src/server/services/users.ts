import "server-only";

import { User } from "@/server/models";
import { allowAccountCreation, auth } from "@/server/auth/auth";
import { connectDB } from "@/server/db";
import { AppError } from "@/server/errors";
import type { UserRole } from "@/lib/constants";

export type TeamMember = { id: string; name: string; email: string; image: string | null; role: UserRole };

/** Everyone on the team, for assignee pickers and the members list. */
export async function listTeamMembers(): Promise<TeamMember[]> {
  await connectDB();
  const users = await User.find({}, { name: 1, email: 1, image: 1, role: 1 }).sort({ name: 1 }).lean();
  return users.map((u) => ({
    id: String(u._id),
    name: u.name ?? u.email ?? "Unknown",
    email: u.email ?? "",
    image: u.image ?? null,
    role: u.role === "admin" ? "admin" : "member",
  }));
}

/**
 * Admin-only (check with assertAdmin before calling): creates a member account with a starting password.
 * Uses Better Auth's internal adapter so the admin's own session is untouched (signUpEmail would sign the
 * admin in as the new member through the nextCookies plugin).
 */
export async function createTeamMember(input: { name: string; email: string; password: string; role: UserRole }) {
  await connectDB();
  const email = input.email.trim().toLowerCase();
  const exists = await User.exists({ email });
  if (exists) throw new AppError("Someone with this email is already on the team.", "conflict", { email: ["Already in use"] });
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const user = await allowAccountCreation.run(true, () =>
    ctx.internalAdapter.createUser({ name: input.name.trim(), email, emailVerified: false }, { method: "admin" }),
  );
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
  if (input.role === "admin") {
    await User.updateOne({ _id: user.id }, { $set: { role: "admin" } });
  }
  return { id: user.id, name: user.name, email: user.email };
}
