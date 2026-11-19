"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { notFound } from "@/server/errors";
import { FileModel, Income } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { attachFiles, removeFile } from "@/features/files/server";
import { getCurrentUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { incomeFormSchema, incomeIdSchema, type IncomeFormValues } from "./schemas";
import { getIncome } from "./queries";
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
  };
}

export const createIncome = defineAction(
  incomeFormSchema,
  async (input, user) => {
    const doc = toDocument(input);
    const number = await nextNumber("income", undefined, doc.date);
    const created = await Income.create({ ...doc, number, createdBy: new Types.ObjectId(user.id) });
    if (input.receiptId) await attachFiles([input.receiptId], { type: "income", id: String(created._id) }, input.projectId);
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Income recorded" },
);

export const updateIncome = defineAction(
  incomeFormSchema.and(incomeIdSchema),
  async (input) => {
    const existing = await Income.findById(input.id).lean();
    if (!existing) throw notFound("The income record");
    const doc = toDocument(input);
    await Income.updateOne(
      { _id: existing._id },
      { $set: doc, $unset: { ...(doc.project ? {} : { project: 1 }), ...(doc.receipt ? {} : { receipt: 1 }) } },
    );
    // A replaced receipt is deleted from storage.
    if (existing.receipt && String(existing.receipt) !== input.receiptId) await removeFile(String(existing.receipt));
    if (input.receiptId) await attachFiles([input.receiptId], { type: "income", id: input.id }, input.projectId);
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Income updated" },
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
  { revalidate: REVALIDATE, message: "Income deleted", role: "admin" },
);

/** Loads one income record for the detail drawer / edit form. */
export async function fetchIncome(id: string): Promise<IncomeDetail | null> {
  if (!(await getCurrentUser())) return null;
  return getIncome(id);
}

/** Removes an uploaded receipt that was never saved with an income record (form cancelled or receipt replaced). */
export async function discardUnsavedIncomeReceipt(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
