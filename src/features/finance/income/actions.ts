"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
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
    await assertUsableReceipt(input.receiptId, user.id);
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
  async (input, user) => {
    const existing = await Income.findById(input.id).lean();
    if (!existing) throw notFound("The income record");
    // Removing or replacing a saved receipt deletes the stored file, and deletes are admin-only.
    if (user.role !== "admin" && existing.receipt && String(existing.receipt) !== input.receiptId) {
      throw new AppError("Only an admin can remove or replace a saved receipt.", "forbidden", { receiptId: ["Only an admin can change this receipt"] });
    }
    await assertUsableReceipt(input.receiptId, user.id, { id: input.id, receipt: existing.receipt });
    const doc = toDocument(input);
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
