"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { AccountTransfer, BankAccount, BankTransaction } from "@/server/models";
import { can, getCurrentUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { unmatchHint } from "@/features/finance/bank-statements/line-href";
import { bankAccountFormSchema, idSchema, transferFormSchema, type BankAccountFormValues } from "./schemas";
import { assertDefaultsFree, createAccountTransfer } from "./server";
import { getBankAccount } from "./queries";
import type { BankAccountDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/** Only the fields the form shows; everything else on the account is left as it is. */
function toFields(v: BankAccountFormValues) {
  return {
    name: v.name,
    kind: v.kind,
    bankName: v.kind === "bank" ? v.bankName : undefined,
    accountLast4: v.kind === "bank" ? v.accountLast4 : undefined,
    ifsc: v.kind === "bank" ? v.ifsc : undefined,
    openingBalance: round2(v.openingBalance),
    openingDate: fromDateInput(v.openingDate),
    defaultFor: [...new Set(v.defaultFor)],
    notes: v.notes,
  };
}

export const createBankAccount = defineAction(
  bankAccountFormSchema,
  async (input, user) => {
    const fields = toFields(input);
    await assertDefaultsFree(fields.defaultFor);
    const created = await BankAccount.create({ ...fields, createdBy: new Types.ObjectId(user.id) });
    return { id: String(created._id), name: created.name };
  },
  { revalidate: REVALIDATE, message: "Account added", permission: "finance.cash_bank:create" },
);

export const updateBankAccount = defineAction(
  bankAccountFormSchema.and(idSchema),
  async (input) => {
    const existing = await BankAccount.findById(input.id, { _id: 1 }).lean();
    if (!existing) throw notFound("The account");
    const fields = toFields(input);
    await assertDefaultsFree(fields.defaultFor, input.id);
    // $set only what the form holds; a field the person cleared is unset, nothing else is touched.
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) unset[key] = 1;
      else set[key] = value;
    }
    await BankAccount.updateOne({ _id: existing._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Account updated", permission: "finance.cash_bank:edit" },
);

/**
 * Archived accounts leave the "Paid from" pickers but keep their history and balance. The
 * defaults they hold stay with them, so older records do not move to another account.
 */
export const archiveBankAccount = defineAction(
  idSchema,
  async ({ id }) => {
    const res = await BankAccount.updateOne({ _id: new Types.ObjectId(id), archivedAt: null }, { $set: { archivedAt: new Date() } });
    if (!res.matchedCount && !(await BankAccount.exists({ _id: new Types.ObjectId(id) }))) throw notFound("The account");
    return { id };
  },
  { revalidate: REVALIDATE, message: "Account archived", permission: "finance.cash_bank:edit" },
);

export const restoreBankAccount = defineAction(
  idSchema,
  async ({ id }) => {
    const res = await BankAccount.updateOne({ _id: new Types.ObjectId(id) }, { $set: { archivedAt: null } });
    if (!res.matchedCount) throw notFound("The account");
    return { id };
  },
  { revalidate: REVALIDATE, message: "Account restored", permission: "finance.cash_bank:edit" },
);

export const recordTransfer = defineAction(
  transferFormSchema,
  async (input, user) => {
    const date = fromDateInput(input.date);
    return createAccountTransfer(
      {
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: input.amount,
        date,
        reference: input.reference,
        notes: input.notes,
      },
      user.id,
    );
  },
  { revalidate: REVALIDATE, message: "Transfer recorded", permission: "finance.cash_bank:create" },
);

/**
 * Deletes a transfer after the person confirmed it. A transfer that a bank statement line became
 * is left alone: that line would point at nothing and the statement could not be imported again.
 */
export const deleteTransfer = defineAction(
  idSchema,
  async ({ id }) => {
    const existing = await AccountTransfer.findById(id, { _id: 1, bankTransactions: 1 }).lean();
    if (!existing) throw notFound("The transfer");
    const pointing = await BankTransaction.find({ "link.kind": "accountTransfer", "link.id": existing._id }, { _id: 1 }).lean();
    // Each account's statement may show it, so up to two lines: every one must be unmatched first.
    const lines = [...new Set([...(existing.bankTransactions ?? []).map(String), ...pointing.map((t) => String(t._id))])];
    if (lines.length) {
      throw new AppError(
        `This transfer is tied to ${lines.length === 1 ? "a bank statement line" : "a line on each account's bank statement"}, so it can't be deleted here.${unmatchHint(lines)}`,
        "conflict",
      );
    }
    await AccountTransfer.deleteOne({ _id: existing._id });
    return { id };
  },
  { revalidate: REVALIDATE, message: "Transfer deleted", permission: "finance.cash_bank:delete" },
);

/** Loads one account for the edit form. Needs Cash & bank view, like the page. */
export async function fetchBankAccount(id: string): Promise<BankAccountDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.cash_bank:view") || !Types.ObjectId.isValid(id)) return null;
  return getBankAccount(id);
}
