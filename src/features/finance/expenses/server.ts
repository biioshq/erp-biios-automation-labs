import "server-only";

import { Types } from "mongoose";
import { AppError } from "@/server/errors";
import { BankAccount } from "@/server/models";
import { can, type SessionUser } from "@/server/auth/session";

/** Checks shared by the expense actions and the payment actions. */

/**
 * Individual pay needs the salaries data permission: without it a person can neither write a salary
 * expense nor turn one into something else.
 */
export function assertMaySalary(user: SessionUser, ...categories: (string | undefined)[]) {
  if (!can(user, "data.salaries") && categories.includes("salaries")) {
    throw new AppError("You do not have permission to add or change salary payments.", "forbidden");
  }
}

/**
 * A "Paid from" account must exist and be open. The one a record already uses always stays
 * allowed, so an old record whose account was archived since can still be saved.
 */
export async function assertAccountUsable(accountId: string | undefined, current?: unknown, field = "accountId"): Promise<void> {
  if (!accountId || String(current ?? "") === accountId) return;
  const account = await BankAccount.findById(accountId, { archivedAt: 1 }).lean();
  if (!account) throw new AppError("That account was not found. Pick another one.", "invalid", { [field]: ["Pick an account from the list"] });
  if (account.archivedAt) {
    throw new AppError("That account is archived, so it takes no new payments. Pick another one.", "conflict", { [field]: ["This account is archived"] });
  }
}

export const toObjectId = (id: string | undefined) => (id ? new Types.ObjectId(id) : undefined);

/** Paise tolerance for comparing rupee amounts that were summed as floats. */
export const HALF_PAISA = 0.005;
