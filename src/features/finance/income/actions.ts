"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { FileModel, Income } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { attachFiles, removeFile } from "@/features/files/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { incomeFormSchema, incomeIdSchema, type IncomeFormValues } from "./schemas";
import { getIncome } from "./queries";
import { assertAccount, assertReceiptLink } from "@/features/finance/invoices/server";
import type { IncomeDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

function toDocument(v: IncomeFormValues) {
  return {
    client: v.client,
    project: v.projectId ? new Types.ObjectId(v.projectId) : undefined,
    category: v.category,
    amount: round2(v.amount),
    date: fromDateInput(v.date),
    paymentMethod: v.paymentMethod,
    reference: v.reference,
    notes: v.notes,
    receipt: v.receiptId ? new Types.ObjectId(v.receiptId) : undefined,
    account: v.accountId ? new Types.ObjectId(v.accountId) : undefined,
    invoice: v.invoiceId ? new Types.ObjectId(v.invoiceId) : undefined,
  };
}

/**
 * "On credit" is not money received: an amount still to come goes on an invoice. New records can't use
 * it; a record saved with it before keeps it when edited (`current`).
 */
function assertReceivedMethod(method: string, current?: string | null) {
  if (method !== "credit" || current === "credit") return;
  throw new AppError("Income records money already received. An amount not received yet goes on an invoice.", "invalid", {
    paymentMethod: ["Pick how the money was received"],
  });
}

/** The account must be open (or already on the record) and the invoice must be one this receipt may settle. */
async function assertLinks(
  v: IncomeFormValues,
  existing?: { id: string; amount: number; account?: Types.ObjectId | null; invoice?: Types.ObjectId | null },
) {
  await assertAccount(v.accountId, existing?.account);
  if (!v.invoiceId) return;
  // Settling an invoice needs money in: a record on credit can't.
  if (v.paymentMethod === "credit") {
    throw new AppError("A record on credit is not money received, so it can't settle an invoice. Pick how the money was received.", "invalid", {
      paymentMethod: ["Pick how the money was received"],
    });
  }
  // The books count a receipt from its date; a future-dated one would show the invoice as paid
  // on the invoices page while the balance sheet still shows it as owed.
  if (v.date > toDateInput(new Date())) {
    throw new AppError("A payment dated later than today can't settle an invoice yet. Record it on the day it is received.", "invalid", {
      date: ["Cannot be later than today when an invoice is linked"],
    });
  }
  const unchanged = Boolean(existing?.invoice && String(existing.invoice) === v.invoiceId && round2(v.amount) <= existing.amount);
  await assertReceiptLink({
    invoiceId: v.invoiceId,
    client: v.client,
    projectId: v.projectId,
    amount: v.amount,
    excludeIncomeId: existing?.id,
    // Keeping the same invoice without raising the amount never asks for the confirmation again.
    allowOverpayment: v.allowOverpayment || unchanged,
  });
}

/**
 * A receipt id from the form must be a file this user just uploaded and has not saved anywhere yet,
 * or the receipt this income already has. Otherwise a known file id could pull another record's
 * receipt over to this income, and replacing or deleting the income would then delete it.
 */
async function assertUsableReceipt(receiptId: string | undefined, userId: string, existing?: { id: string; receipt?: Types.ObjectId | null }) {
  if (!receiptId) return;
  if (existing?.receipt && String(existing.receipt) === receiptId) return;
  const ok = await FileModel.exists({
    _id: new Types.ObjectId(receiptId),
    $or: [
      { "entity.id": null, uploadedBy: new Types.ObjectId(userId) },
      ...(existing ? [{ "entity.type": "income" as const, "entity.id": new Types.ObjectId(existing.id) }] : []),
    ],
  });
  if (!ok) throw new AppError("That receipt can't be used here. Upload the file again.", "invalid", { receiptId: ["Upload the receipt again"] });
}

export const createIncome = defineAction(
  incomeFormSchema,
  async (input, user) => {
    assertReceivedMethod(input.paymentMethod);
    await assertUsableReceipt(input.receiptId, user.id);
    await assertLinks(input);
    const doc = toDocument(input);
    const number = await nextNumber("income", undefined, doc.date);
    const created = await Income.create({ ...doc, number, createdBy: new Types.ObjectId(user.id) });
    if (input.receiptId) await attachFiles([input.receiptId], { type: "income", id: String(created._id) }, input.projectId);
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Income recorded", permission: "finance.income:create" },
);

export const updateIncome = defineAction(
  incomeFormSchema.and(incomeIdSchema),
  async (input, user) => {
    const existing = await Income.findById(input.id).lean();
    if (!existing) throw notFound("The income record");
    assertReceivedMethod(input.paymentMethod, existing.paymentMethod);
    // Removing or replacing a saved receipt deletes the stored file, so it needs the delete permission.
    if (!can(user, "finance.income:delete") && existing.receipt && String(existing.receipt) !== input.receiptId) {
      throw new AppError("You do not have permission to remove or replace a saved receipt.", "forbidden", { receiptId: ["You cannot change this receipt"] });
    }
    await assertUsableReceipt(input.receiptId, user.id, { id: input.id, receipt: existing.receipt });
    await assertLinks(input, { id: input.id, amount: existing.amount, account: existing.account, invoice: existing.invoice });
    const doc = toDocument(input);
    // Only the form's fields are set, so links the form does not show (bank statement line) are kept.
    // Mongoose drops undefined values from $set, so a field the user cleared has to be unset explicitly.
    await Income.updateOne(
      { _id: existing._id },
      {
        $set: doc,
        $unset: {
          ...(doc.project ? {} : { project: 1 }),
          ...(doc.receipt ? {} : { receipt: 1 }),
          ...(doc.reference ? {} : { reference: 1 }),
          ...(doc.notes ? {} : { notes: 1 }),
          ...(doc.account ? {} : { account: 1 }),
          ...(doc.invoice ? {} : { invoice: 1 }),
        },
      },
    );
    // A replaced receipt is deleted from storage.
    if (existing.receipt && String(existing.receipt) !== input.receiptId) await removeFile(String(existing.receipt));
    if (input.receiptId) {
      await attachFiles([input.receiptId], { type: "income", id: input.id }, input.projectId);
      // attachFiles only sets a project. Once the income is unlinked, its receipt must not stay
      // tagged to the old project, or deleting that project would delete this receipt too.
      if (!input.projectId) await FileModel.updateOne({ _id: new Types.ObjectId(input.receiptId) }, { $unset: { project: 1 } });
    }
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Income updated", permission: "finance.income:edit" },
);

export const deleteIncome = defineAction(
  incomeIdSchema,
  async ({ id }) => {
    const existing = await Income.findById(id).lean();
    if (!existing) throw notFound("The income record");
    await Income.deleteOne({ _id: existing._id });
    if (existing.receipt) await removeFile(String(existing.receipt));
    return { id };
  },
  { revalidate: REVALIDATE, message: "Income deleted", permission: "finance.income:delete" },
);

/** Loads one income record for the detail drawer / edit form. */
export async function fetchIncome(id: string): Promise<IncomeDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.income:view")) return null;
  return getIncome(id);
}

/** Removes an uploaded receipt that was never saved with an income record (form cancelled or receipt replaced). */
export async function discardUnsavedIncomeReceipt(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
