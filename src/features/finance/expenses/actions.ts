"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Expense, FileModel } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { attachFiles, removeFile } from "@/features/files/server";
import { getCurrentUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { gstGrandTotal } from "@/lib/gst";
import { expenseFormSchema, expenseIdSchema, type ExpenseFormValues } from "./schemas";
import { getExpense } from "./queries";
import type { ExpenseDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

function toDocument(v: ExpenseFormValues) {
  const g = v.gst;
  const hasGst = Boolean(g.gstin || g.invoiceNumber || (g.taxableAmount ?? 0) > 0);
  return {
    vendor: v.vendor,
    vendorAddress: v.vendorAddress,
    project: v.projectId ? new Types.ObjectId(v.projectId) : undefined,
    stage: v.projectId ? v.stage : undefined,
    category: v.category,
    description: v.description,
    amount: round2(v.amount),
    date: fromDateInput(v.date),
    paymentMethod: v.paymentMethod,
    notes: v.notes,
    gst: hasGst
      ? {
          gstin: g.gstin,
          invoiceNumber: g.invoiceNumber,
          invoiceDate: g.invoiceDate ? fromDateInput(g.invoiceDate) : undefined,
          taxableAmount: round2(g.taxableAmount ?? 0),
          cgst: round2(g.cgst ?? 0),
          sgst: round2(g.sgst ?? 0),
          igst: round2(g.igst ?? 0),
          cess: round2(g.cess ?? 0),
          hsnSac: g.hsnSac,
          grandTotal: (g.taxableAmount ?? 0) > 0 ? gstGrandTotal(g) : round2(v.amount),
        }
      : undefined,
    receipt: v.receiptId ? new Types.ObjectId(v.receiptId) : undefined,
    ocr: v.ocr,
  };
}

export const createExpense = defineAction(
  expenseFormSchema,
  async (input, user) => {
    const doc = toDocument(input);
    const number = await nextNumber("expense", undefined, doc.date);
    const created = await Expense.create({ ...doc, number, source: "manual", createdBy: new Types.ObjectId(user.id) });
    if (input.receiptId) await attachFiles([input.receiptId], { type: "expense", id: String(created._id) }, input.projectId);
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Expense added" },
);

export const updateExpense = defineAction(
  expenseFormSchema.and(expenseIdSchema),
  async (input) => {
    const existing = await Expense.findById(input.id).lean();
    if (!existing) throw notFound("The expense");
    if (existing.source === "inventory_assignment") {
      throw new AppError("This expense comes from an inventory assignment. Change it by returning stock from the project.", "conflict");
    }
    const doc = toDocument(input);
    // Generated fields (recurring schedule, employee, occurrence key) are kept as they are.
    await Expense.updateOne(
      { _id: existing._id },
      { $set: doc, $unset: { ...(doc.gst ? {} : { gst: 1 }), ...(doc.project ? {} : { project: 1, stage: 1 }), ...(doc.receipt ? {} : { receipt: 1 }) } },
    );
    // A replaced receipt is deleted from storage.
    if (existing.receipt && String(existing.receipt) !== input.receiptId) await removeFile(String(existing.receipt));
    if (input.receiptId) await attachFiles([input.receiptId], { type: "expense", id: input.id }, input.projectId);
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Expense updated" },
);

export const deleteExpense = defineAction(
  expenseIdSchema,
  async ({ id }) => {
    const existing = await Expense.findById(id).lean();
    if (!existing) throw notFound("The expense");
    if (existing.source === "inventory_assignment") {
      throw new AppError("This expense comes from an inventory assignment. Return the stock from the project to reverse it.", "conflict");
    }
    await Expense.deleteOne({ _id: existing._id });
    if (existing.receipt) await removeFile(String(existing.receipt));
    return { id };
  },
  { revalidate: REVALIDATE, message: "Expense deleted", role: "admin" },
);

/** Loads one expense for the detail drawer / edit form. */
export async function fetchExpense(id: string): Promise<ExpenseDetail | null> {
  if (!(await getCurrentUser())) return null;
  return getExpense(id);
}

/** Removes an uploaded receipt that was never saved with an expense (form cancelled or receipt replaced). */
export async function discardUnsavedReceipt(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
