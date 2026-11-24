import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { AppError } from "@/server/errors";
import { AccountTransfer, BankAccount } from "@/server/models";
import { PAYMENT_METHODS, labelOf, type PaymentMethod } from "@/lib/constants";
import { startOfDayIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { MAX_MONEY } from "@/lib/zod";

/**
 * Server-only helpers for cash and bank accounts, shared by this area's actions and by other
 * features (bank statement import records transfers through createAccountTransfer).
 */

export type CreateAccountTransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: Date;
  reference?: string;
  notes?: string;
  bankTransactionIds?: string[];
};

const trimTo = (value: string | undefined, max: number) => {
  const v = value?.trim();
  return v ? v.slice(0, max) : undefined;
};

/**
 * Records money moved between two of the company's own accounts. It is neither income nor
 * expense: the accounting engine moves the amount from one account to the other on that day.
 * Both accounts must exist and be open (not archived).
 */
export async function createAccountTransfer(input: CreateAccountTransferInput, userId: string): Promise<{ id: string }> {
  await connectDB();
  const { fromAccountId, toAccountId } = input;
  if (!Types.ObjectId.isValid(fromAccountId) || !Types.ObjectId.isValid(toAccountId)) {
    throw new AppError("Pick both accounts.", "invalid", { fromAccountId: ["Pick an account"] });
  }
  if (fromAccountId === toAccountId) {
    throw new AppError("A transfer needs two different accounts.", "invalid", { toAccountId: ["Pick a different account"] });
  }
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONEY) {
    throw new AppError("Enter an amount more than zero.", "invalid", { amount: ["Must be more than zero"] });
  }
  const date = new Date(input.date);
  if (Number.isNaN(date.getTime())) throw new AppError("Pick a date.", "invalid", { date: ["Pick a date"] });

  const accounts = await BankAccount.find({ _id: { $in: [fromAccountId, toAccountId] } }, { name: 1, archivedAt: 1 }).lean();
  const from = accounts.find((a) => String(a._id) === fromAccountId);
  const to = accounts.find((a) => String(a._id) === toAccountId);
  if (!from) throw new AppError("The account the money left was not found.", "not_found", { fromAccountId: ["Not found"] });
  if (!to) throw new AppError("The account the money went into was not found.", "not_found", { toAccountId: ["Not found"] });
  for (const [a, field] of [[from, "fromAccountId"], [to, "toAccountId"]] as const) {
    if (a.archivedAt) throw new AppError(`${a.name} is archived. Restore it first to record a transfer.`, "invalid", { [field]: ["Archived account"] });
  }

  const txIds = (input.bankTransactionIds ?? []).filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const created = await AccountTransfer.create({
    from: from._id,
    to: to._id,
    amount,
    // Business dates are IST calendar days, stored at IST midnight like every other record.
    date: startOfDayIST(date),
    reference: trimTo(input.reference, 120),
    notes: trimTo(input.notes, 1000),
    ...(txIds.length ? { bankTransactions: txIds } : {}),
    createdBy: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined,
  });
  return { id: String(created._id) };
}

/**
 * Each payment method may be the default of one account only. Throws, naming the account that
 * already holds a method, so the person moves it on purpose rather than by accident.
 */
export async function assertDefaultsFree(methods: string[], exceptId?: string): Promise<void> {
  if (!methods.length) return;
  const taken = await BankAccount.find(
    { defaultFor: { $in: methods }, ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}) },
    { name: 1, defaultFor: 1 },
  ).lean();
  if (!taken.length) return;
  const clashes = methods.flatMap((m) => {
    const owner = taken.find((a) => (a.defaultFor ?? []).includes(m));
    return owner ? [`${labelOf(PAYMENT_METHODS, m as PaymentMethod)} is already the default for ${owner.name}`] : [];
  });
  throw new AppError(`${clashes.join("; ")}. Remove it from that account first.`, "conflict", { defaultFor: clashes });
}
