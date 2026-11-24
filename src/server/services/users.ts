import "server-only";

import { Types } from "mongoose";
import { User } from "@/server/models";
import { auth } from "@/server/auth/auth";
import { roleKeyOf } from "@/server/auth/permissions";
import { connectDB } from "@/server/db";
import { AppError } from "@/server/errors";
import type { UserRole } from "@/lib/constants";

/** role is the role key as stored: "admin", "member" or a custom role's key. */
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
    role: roleKeyOf(u.role),
  }));
}

/**
 * Creates an account with a starting password. Callers check the actor's permission and that they
 * may give this role (src/features/team/rules.ts) first.
 *
 * The user document is written here in the shape Better Auth gives it (verified, since only people
 * with the permission add accounts), not through internalAdapter.createUser: that call runs the
 * validateUserInfo hook, which needs a Better Auth endpoint context a server action does not have.
 * The password sign-in is linked through Better Auth's adapter so it is hashed and stored its way.
 * The actor's own session is untouched (signUpEmail would sign them in as the new person).
 */
export async function createTeamMember(input: { name: string; email: string; password: string; role: UserRole }, actorId?: string) {
  await connectDB();
  const email = input.email.trim().toLowerCase();
  const exists = await User.exists({ email });
  if (exists) throw new AppError("Someone with this email is already on the team.", "conflict", { email: ["Already in use"] });
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const now = new Date();
  const _id = new Types.ObjectId();
  await User.collection.insertOne({
    _id,
    name: input.name.trim(),
    email,
    emailVerified: true,
    image: null,
    role: roleKeyOf(input.role),
    createdAt: now,
    updatedAt: now,
    ...(actorId ? { createdBy: new Types.ObjectId(actorId) } : {}),
  });
  const id = String(_id);
  try {
    await ctx.internalAdapter.linkAccount({ userId: id, providerId: "credential", accountId: id, password: hash });
  } catch (error) {
    // No half-made accounts: without a password sign-in the person could not sign in.
    await User.collection.deleteOne({ _id });
    throw error;
  }
  return { id, name: input.name.trim(), email };
}

/** Changes a person's role key. Callers check the rules first. */
export async function setUserRole(userId: string, role: string, actorId: string) {
  await connectDB();
  await User.updateOne(
    { _id: new Types.ObjectId(userId) },
    { $set: { role: roleKeyOf(role), updatedAt: new Date(), updatedBy: new Types.ObjectId(actorId) } },
  );
}

/** Changes a person's display name. */
export async function setUserName(userId: string, name: string, actorId: string) {
  await connectDB();
  await User.updateOne(
    { _id: new Types.ObjectId(userId) },
    { $set: { name: name.trim(), updatedAt: new Date(), updatedBy: new Types.ObjectId(actorId) } },
  );
}

/**
 * Sets a new password for someone else (callers check the rules first). Updates their password
 * sign-in, or adds one when they only signed in with Google. With signOut, every session of theirs
 * ends, so other devices have to sign in again with the new password.
 */
export async function setUserPassword(userId: string, password: string, options: { signOut: boolean; actorId: string }) {
  await connectDB();
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  // Accounts made by sign-up or by an admin use the user id as accountId; match on the provider so
  // an older account with another accountId is still found.
  const credential = accounts.find((a) => a.providerId === "credential" && a.accountId === userId) ?? accounts.find((a) => a.providerId === "credential");
  if (credential) {
    await ctx.internalAdapter.updateAccount(credential.id, { password: hash });
  } else {
    await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
  }
  // Read back: never report success when nothing changed.
  const after = (await ctx.internalAdapter.findAccounts(userId)).find((a) => (credential ? a.id === credential.id : a.providerId === "credential"));
  if (!after?.password || !(await ctx.password.verify({ hash: after.password, password }))) {
    throw new AppError("The new password could not be saved. Try again.", "invalid");
  }
  await User.updateOne(
    { _id: new Types.ObjectId(userId) },
    { $set: { updatedAt: new Date(), updatedBy: new Types.ObjectId(options.actorId), passwordSetBy: new Types.ObjectId(options.actorId), passwordSetAt: new Date() } },
  );
  if (options.signOut) await ctx.internalAdapter.deleteUserSessions(userId);
  return { created: !credential };
}
