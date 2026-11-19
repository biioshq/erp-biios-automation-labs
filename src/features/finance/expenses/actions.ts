"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Expense, FileModel, Project } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { gstGrandTotal, totalTax } from "@/lib/gst";
import { expenseFormSchema, expenseIdSchema, type ExpenseFormValues } from "./schemas";
import { getExpense } from "./queries";
import type { ExpenseDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

function toDocument(v: ExpenseFormValues) {
  const g = v.gst;
  // Tax typed without a GSTIN or invoice number is still input tax, so it keeps the GST block.
  const hasGst = Boolean(g.gstin || g.invoiceNumber || (g.taxableAmount ?? 0) > 0 || totalTax(g) > 0);
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

/** Individual pay is admin-only, so members can neither write a salary expense nor turn one into something else. */
function assertMaySalary(user: SessionUser, ...categories: (string | undefined)[]) {
  if (user.role !== "admin" && categories.includes("salaries")) {
    throw new AppError("Only an admin can add or change salary payments.", "forbidden");
  }
}

/**
 * The project must exist, and a cancelled project takes no new expenses. An expense already on a cancelled
 * project can still be edited (currentProject), so old records stay fixable.
 */
async function assertProjectOpen(projectId: string | undefined, currentProject?: unknown) {
  if (!projectId) return;
  const project = await Project.findById(projectId, { status: 1 }).lean();
  if (!project) throw notFound("The project");
  if (project.status === "cancelled" && String(currentProject ?? "") !== projectId) {
    throw new AppError("This project is cancelled, so it takes no new expenses. Pick another project.", "conflict", {
      projectId: ["This project is cancelled"],
    });
  }
}

/**
 * The receipt must be this user's unsaved upload or already this expense's. Otherwise a known file id would pull
 * another record's receipt over, and replacing this expense's receipt later would delete it from storage.
 */
async function assertReceiptFree(receiptId: string | undefined, user: SessionUser, expenseId: string | null, currentReceipt?: unknown) {
  if (!receiptId || String(currentReceipt ?? "") === receiptId) return;
  if (!(await isClaimableFile(receiptId, expenseId, { kind: "receipt", uploadedBy: user.id }))) {
    throw new AppError("This receipt can't be used here. Upload the file again.", "conflict", { receiptId: ["Upload the receipt again"] });
  }
}

/** Removing or replacing a saved receipt deletes the stored file, and deletes are admin-only. */
function assertMayDropReceipt(user: SessionUser, currentReceipt: unknown, receiptId: string | undefined) {
  if (user.role !== "admin" && currentReceipt && String(currentReceipt) !== receiptId) {
    throw new AppError("Only an admin can remove or replace a saved receipt.", "forbidden", { receiptId: ["Only an admin can change this receipt"] });
  }
}

/**
 * Fields the form left empty are removed, not skipped: Mongoose drops undefined values from $set, so a cleared
 * note, description or address (or the OCR map of a removed receipt) would otherwise keep its old value.
 */
function toUpdate(doc: ReturnType<typeof toDocument>) {
  const entries = Object.entries(doc);
  return {
    $set: Object.fromEntries(entries.filter(([, v]) => v !== undefined)),
    $unset: Object.fromEntries(entries.filter(([, v]) => v === undefined).map(([k]) => [k, 1 as const])),
  };
}

export const createExpense = defineAction(
  expenseFormSchema,
  async (input, user) => {
    assertMaySalary(user, input.category);
    await assertProjectOpen(input.projectId);
    await assertReceiptFree(input.receiptId, user, null);
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
  async (input, user) => {
    const existing = await Expense.findById(input.id).lean();
    if (!existing) throw notFound("The expense");
    if (existing.source === "inventory_assignment") {
      throw new AppError("This expense comes from an inventory assignment. Change it by returning stock from the project.", "conflict");
    }
    assertMaySalary(user, existing.category, input.category);
    await assertProjectOpen(input.projectId, existing.project);
    assertMayDropReceipt(user, existing.receipt, input.receiptId);
    await assertReceiptFree(input.receiptId, user, input.id, existing.receipt);
    // Generated fields (recurring schedule, employee, occurrence key) are not in the form and are kept as they are.
    await Expense.updateOne({ _id: existing._id }, toUpdate(toDocument(input)));
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
