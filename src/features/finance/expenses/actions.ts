"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Expense, FileModel, FixedAsset, Project } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
import { assertExpenseCategoryAllowed } from "@/server/expense-categories";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatCurrency, formatDate, round2 } from "@/lib/format";
import { gstGrandTotal, totalTax } from "@/lib/gst";
import { unmatchHint } from "@/features/finance/bank-statements/line-href";
import { expenseFormSchema, expenseIdSchema, resolvePaymentMode, type ExpenseFormValues } from "./schemas";
import { getExpense } from "./queries";
import { generatedNote, isGeneratedExpense } from "./sources";
import { HALF_PAISA, assertAccountUsable, assertMaySalary, toObjectId } from "./server";
import type { ExpenseDetail } from "./types";
import { auditSafely, hideEarlierAsSalary } from "@/server/audit";
import { expenseCreated, expenseDeleted, expenseEdited } from "@/features/finance/audit/records";

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
    notes: v.notes,
    department: v.department,
    prepaid: v.prepaidFrom && v.prepaidTo ? { from: fromDateInput(v.prepaidFrom), to: fromDateInput(v.prepaidTo) } : undefined,
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

type FieldChanges = { set: Record<string, unknown>; unset: string[] };

/**
 * The payment fields of a new expense, or of an edit to one that has no payments recorded one by
 * one. Paid in full keeps today's meaning (paid on its date with its method, from `account` or the
 * method's default account). Partly paid stores what was paid now as the first payment. Not paid
 * yet is "On credit". A due date is kept as it is unless the form sends one.
 */
function paymentFields(v: ExpenseFormValues, userId: string): FieldChanges {
  const mode = resolvePaymentMode(v);
  const dueDate = v.dueDate ? { dueDate: fromDateInput(v.dueDate) } : {};
  if (mode === "partial") {
    const payment = {
      _id: new Types.ObjectId(),
      date: fromDateInput(v.date),
      amount: round2(v.paidAmount ?? 0),
      paymentMethod: v.paymentMethod,
      account: toObjectId(v.accountId),
      createdBy: new Types.ObjectId(userId),
    };
    return { set: { paymentMethod: v.paymentMethod, payments: [payment], ...dueDate }, unset: ["account"] };
  }
  if (mode === "none") return { set: { paymentMethod: "credit", ...dueDate }, unset: ["account"] };
  return v.accountId
    ? { set: { paymentMethod: v.paymentMethod, account: new Types.ObjectId(v.accountId) }, unset: [] }
    : { set: { paymentMethod: v.paymentMethod }, unset: ["account"] };
}

/**
 * An expense with payments recorded one by one keeps them, its method and its account: payments
 * change only through Record payment. The form may still move the due date, and the amount can
 * never go below what was paid.
 */
function explicitPaymentFields(v: ExpenseFormValues, existing: { payments?: { amount: number }[] | null }): FieldChanges {
  const paid = round2((existing.payments ?? []).reduce((s, p) => s + (p.amount || 0), 0));
  if (round2(v.amount) < paid - HALF_PAISA) {
    throw new AppError(`${formatCurrency(paid, { exact: true })} is already paid on this expense, so the amount can't be less than that.`, "conflict", {
      amount: [`At least ${formatCurrency(paid, { exact: true })} (already paid)`],
    });
  }
  // The form always sends the stored due date back, so an empty one means it was cleared on purpose.
  return v.dueDate ? { set: { dueDate: fromDateInput(v.dueDate) }, unset: [] } : { set: {}, unset: ["dueDate"] };
}

/**
 * An expense created from, or matched to, a bank statement line as paid on its date keeps its
 * method and account: the statement shows it paid, so switching it to unpaid or part paid here
 * would put the books and the bank balance out of step. Its amount is the line's, so it stays too.
 */
const BANK_MATCHED_FIELDS: FieldChanges = { set: {}, unset: [] };

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

/** Removing or replacing a saved receipt deletes the stored file, so it needs the delete permission. */
function assertMayDropReceipt(user: SessionUser, currentReceipt: unknown, receiptId: string | undefined) {
  if (!can(user, "finance.expenses:delete") && currentReceipt && String(currentReceipt) !== receiptId) {
    throw new AppError("You do not have permission to remove or replace a saved receipt.", "forbidden", { receiptId: ["You cannot change this receipt"] });
  }
}

/**
 * Fields the form left empty are removed, not skipped: Mongoose drops undefined values from $set, so a cleared
 * note, description or address (or the OCR map of a removed receipt) would otherwise keep its old value.
 */
function toUpdate(doc: ReturnType<typeof toDocument>, payment: FieldChanges) {
  const entries = Object.entries(doc);
  const set = { ...Object.fromEntries(entries.filter(([, v]) => v !== undefined)), ...payment.set };
  const unset = [...entries.filter(([, v]) => v === undefined).map(([k]) => k), ...payment.unset].filter((k) => !(k in set));
  return { $set: set, $unset: Object.fromEntries(unset.map((k) => [k, 1 as const])) };
}

/** The fixed asset an expense paid for: by the expense's link, or by the asset's funding (older records). */
async function linkedAsset(e: { _id: Types.ObjectId; capitalAsset?: Types.ObjectId | null }) {
  const fields = { name: 1, code: 1, purchaseCost: 1 };
  return e.capitalAsset ? FixedAsset.findById(e.capitalAsset, fields).lean() : FixedAsset.findOne({ "funding.expense": e._id }, fields).lean();
}

/**
 * An expense that paid for a fixed asset carries the asset's cost into the books on the expense's date.
 * Its date can't move and its amount can't go below the asset's cost, or the asset would be bought on
 * another day than the register says, or for more than was spent. The asset is changed or unlinked first
 * (the expense form links to it).
 */
async function assertAssetAllows(existing: { _id: Types.ObjectId; capitalAsset?: Types.ObjectId | null; date: Date; amount: number }, input: { amount: number; date: string }) {
  const asset = await linkedAsset(existing);
  if (!asset) return;
  const first = `Change or unlink the asset ${asset.name} (${asset.code}) under Fixed assets first.`;
  if (toDateInput(existing.date) !== input.date) {
    throw new AppError(`This expense paid for the fixed asset ${asset.name}, which is bought on ${formatDate(existing.date)}. ${first}`, "conflict", {
      date: [`Paid for ${asset.name}: unlink it to change the date`],
    });
  }
  // An older record whose amount is already below the asset's cost can still be saved without lowering it further.
  const lowered = round2(input.amount) < existing.amount - HALF_PAISA;
  if (lowered && round2(input.amount) < round2(asset.purchaseCost) - HALF_PAISA) {
    const cost = formatCurrency(asset.purchaseCost, { exact: true });
    throw new AppError(`This expense paid for the fixed asset ${asset.name}, which cost ${cost}, so the amount can't be less than that. ${first}`, "conflict", {
      amount: [`At least ${cost} (the cost of ${asset.name})`],
    });
  }
}

/** Generated expenses change only through the record that made them. */
function assertEditable(source: string | null | undefined, action: "edit" | "delete") {
  const s = (source ?? "manual") as Parameters<typeof isGeneratedExpense>[0];
  if (!isGeneratedExpense(s)) return;
  const verb = action === "edit" ? "edited" : "deleted";
  throw new AppError(`This expense can't be ${verb} here. ${generatedNote(s)}`, "conflict");
}

export const createExpense = defineAction(
  expenseFormSchema,
  async (input, user) => {
    assertMaySalary(user, input.category);
    await assertExpenseCategoryAllowed(input.category);
    await assertProjectOpen(input.projectId);
    await assertReceiptFree(input.receiptId, user, null);
    if (resolvePaymentMode(input) !== "none") await assertAccountUsable(input.accountId);
    const doc = toDocument(input);
    const payment = paymentFields(input, user.id);
    const number = await nextNumber("expense", undefined, doc.date);
    const created = await Expense.create({ ...doc, ...payment.set, number, source: "manual", createdBy: new Types.ObjectId(user.id) });
    if (input.receiptId) await attachFiles([input.receiptId], { type: "expense", id: String(created._id) }, input.projectId);
    await auditSafely(() => expenseCreated(created.toObject()));
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Expense added", permission: "finance.expenses:create" },
);

export const updateExpense = defineAction(
  expenseFormSchema.and(expenseIdSchema),
  async (input, user) => {
    const existing = await Expense.findById(input.id).lean();
    if (!existing) throw notFound("The expense");
    assertEditable(existing.source, "edit");
    assertMaySalary(user, existing.category, input.category);
    // Keeping the current category always saves, even if it was hidden since.
    await assertExpenseCategoryAllowed(input.category, existing.category);
    await assertProjectOpen(input.projectId, existing.project);
    assertMayDropReceipt(user, existing.receipt, input.receiptId);
    await assertReceiptFree(input.receiptId, user, input.id, existing.receipt);
    await assertAssetAllows(existing, input);
    const explicit = Array.isArray(existing.payments);
    const bankMatched = !explicit && Boolean(existing.bankTransaction);
    if (bankMatched && Math.abs(round2(input.amount) - existing.amount) > HALF_PAISA) {
      const amount = formatCurrency(existing.amount, { exact: true });
      // Only people who can open bank statements get the way to unmatch it.
      const hint = can(user, "finance.bank_statements:view") ? unmatchHint([String(existing.bankTransaction)]) : "";
      throw new AppError(`This expense is matched to a bank statement line of ${amount}, so its amount can't change here.${hint}`, "conflict", {
        amount: [`Matched to a bank line of ${amount}`],
      });
    }
    if (!explicit && !bankMatched && resolvePaymentMode(input) !== "none") await assertAccountUsable(input.accountId, existing.account);
    const payment = explicit ? explicitPaymentFields(input, existing) : bankMatched ? BANK_MATCHED_FIELDS : paymentFields(input, user.id);
    // Fields the form does not show (recurring schedule, employee, occurrence key, payments, fixed asset,
    // loan, bank statement line) are kept as they are. The guard on updatedAt stops this edit from landing
    // on top of a payment recorded at the same moment, which the amount check above could not see.
    const res = await Expense.updateOne({ _id: existing._id, updatedAt: existing.updatedAt ?? null }, toUpdate(toDocument(input), payment));
    if (!res.matchedCount) {
      throw new AppError("This expense changed while you were saving (perhaps a payment was recorded). Open it again and redo your change.", "conflict");
    }
    // A replaced receipt is deleted from storage.
    if (existing.receipt && String(existing.receipt) !== input.receiptId) await removeFile(String(existing.receipt));
    if (input.receiptId) await attachFiles([input.receiptId], { type: "expense", id: input.id }, input.projectId);
    await auditSafely(async () => {
      const after = await Expense.findById(existing._id).lean();
      // Moved to Salaries: what the trail holds from before is someone's pay now.
      if (after?.category === "salaries" && existing.category !== "salaries") await hideEarlierAsSalary("expense", existing._id);
      return after ? expenseEdited(existing, after) : null;
    });
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Expense updated", permission: "finance.expenses:edit" },
);

export const deleteExpense = defineAction(
  expenseIdSchema,
  async ({ id }, user) => {
    const existing = await Expense.findById(id).lean();
    if (!existing) throw notFound("The expense");
    // A salary expense is one person's pay: deleting it also needs the salaries data permission.
    assertMaySalary(user, existing.category);
    // A stock purchase's receipt is the purchase's too, and the stock it paid for stays on hand; loan
    // interest is part of a repayment. Deleting either here would drop a cost the other record still holds.
    assertEditable(existing.source, "delete");
    // The cost of a fixed asset bought through this expense is booked through it; deleting it would drop the asset's cost.
    const asset = await linkedAsset(existing);
    if (asset) {
      throw new AppError(
        `This expense paid for the fixed asset ${asset.name} (${asset.code}). Unlink it from the asset under Fixed assets, or delete the asset, first.`,
        "conflict",
      );
    }
    await Expense.deleteOne({ _id: existing._id });
    if (existing.receipt) await removeFile(String(existing.receipt));
    await auditSafely(() => expenseDeleted(existing));
    return { id };
  },
  { revalidate: REVALIDATE, message: "Expense deleted", permission: "finance.expenses:delete" },
);

/** Loads one expense for the detail drawer / edit form. */
export async function fetchExpense(id: string): Promise<ExpenseDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.expenses:view")) return null;
  return getExpense(id);
}

/** Removes an uploaded receipt that was never saved with an expense (form cancelled or receipt replaced). */
export async function discardUnsavedReceipt(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
