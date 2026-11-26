"use server";

import { Types } from "mongoose";
import { z } from "zod";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { FileModel, Income, Invoice } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { attachFiles, isClaimableFile, removeFile } from "@/features/files/server";
import { can, getCurrentUser } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { endOfDayIST, fromDateInput, toDateInput } from "@/lib/dates";
import { formatCurrency, round2 } from "@/lib/format";
import { searchRegex } from "@/lib/list-params";
import { objectId, optionalObjectId } from "@/lib/zod";
import {
  applyReceiptSchema,
  invoiceFormSchema,
  invoiceIdSchema,
  invoiceReceiptSchema,
  unlinkReceiptSchema,
  type InvoiceFormValues,
} from "./schemas";
import { invoiceTotals } from "./totals";
import { exactName, getInvoice, openInvoicesFor, unlinkedReceiptsFor } from "./queries";
import { assertAccount, assertReceiptLink } from "./server";
import type { InvoiceDetail, OpenInvoiceOption, UnlinkedReceipt } from "./types";
import { auditSafely } from "@/server/audit";
import { incomeCreated, invoiceCreated, invoiceEdited, invoiceStatus, receiptLink } from "@/features/finance/audit/records";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

const createForReceiptSchema = z.object({ incomeId: objectId });
const prefillInput = createForReceiptSchema;

function toDocument(v: InvoiceFormValues) {
  const totals = invoiceTotals(v.lines, v.interState);
  return {
    client: v.client,
    clientGstin: v.clientGstin,
    project: v.projectId ? new Types.ObjectId(v.projectId) : undefined,
    date: fromDateInput(v.date),
    dueDate: v.dueDate ? fromDateInput(v.dueDate) : undefined,
    interState: v.interState,
    lines: v.lines.map((l, i) => ({
      description: l.description,
      quantity: l.quantity,
      rate: round2(l.rate),
      amount: totals.lineAmounts[i],
      gstRate: l.gstRate,
      hsnSac: l.hsnSac,
    })),
    taxableAmount: totals.taxableAmount,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    total: totals.total,
    notes: v.notes,
    file: v.fileId ? new Types.ObjectId(v.fileId) : undefined,
  };
}

/** Invoice numbers are unique regardless of case, so "inv-7" cannot sit next to "INV-7". */
async function numberTaken(number: string, exceptId?: string): Promise<boolean> {
  const taken = await Invoice.exists({
    number: new RegExp(`^${searchRegex(number.trim()).source}$`, "i"),
    ...(exceptId ? { _id: { $ne: new Types.ObjectId(exceptId) } } : {}),
  });
  return Boolean(taken);
}

async function assertNumberFree(number: string, exceptId?: string) {
  if (await numberTaken(number, exceptId)) throw new AppError(`Invoice number ${number} is already used.`, "conflict", { number: ["Already used by another invoice"] });
}

/** The next INV number not already typed in by hand on another invoice. */
async function freeInvoiceNumber(date: Date): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const number = await nextNumber("invoice", undefined, date);
    // The same check as a typed number, so a hand-typed "inv-…" is skipped too.
    if (!(await numberTaken(number))) return number;
  }
  throw new AppError("Could not find a free invoice number. Type one in.", "conflict", { number: ["Type an invoice number"] });
}

async function assertUsableFile(fileId: string | undefined, userId: string, existing?: { id: string; file?: Types.ObjectId | null }) {
  if (!fileId) return;
  if (existing?.file && String(existing.file) === fileId) return;
  if (!(await isClaimableFile(fileId, existing?.id ?? null, { uploadedBy: userId }))) {
    throw new AppError("That file can't be used here. Upload it again.", "invalid", { fileId: ["Upload the invoice file again"] });
  }
}

const receivedOn = async (invoiceId: Types.ObjectId) =>
  round2(
    (await Income.aggregate<{ total: number }>([{ $match: { invoice: invoiceId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]))[0]?.total ?? 0,
  );

export const createInvoice = defineAction(
  invoiceFormSchema,
  async (input, user) => {
    await assertUsableFile(input.fileId, user.id);
    const doc = toDocument(input);
    if (input.number) await assertNumberFree(input.number);
    const number = input.number ?? (await freeInvoiceNumber(doc.date));
    const created = await Invoice.create({ ...doc, number, status: "issued", createdBy: new Types.ObjectId(user.id) });
    // Invoice papers stay off the project's documents, so deleting a project never deletes them.
    if (input.fileId) await attachFiles([input.fileId], { type: "invoice", id: String(created._id) }, null);
    await auditSafely(() => invoiceCreated(created.toObject()));
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Invoice created", permission: "finance.invoices:create" },
);

export const updateInvoice = defineAction(
  invoiceFormSchema.and(invoiceIdSchema),
  async (input, user) => {
    const existing = await Invoice.findById(input.id).lean();
    if (!existing) throw notFound("The invoice");
    if (existing.status === "cancelled") throw new AppError("This invoice is cancelled. Restore it before editing.", "conflict");
    // Removing or replacing a saved file deletes it, so it needs the delete permission.
    if (!can(user, "finance.invoices:delete") && existing.file && String(existing.file) !== input.fileId) {
      throw new AppError("You do not have permission to remove or replace a saved invoice file.", "forbidden", { fileId: ["You cannot change this file"] });
    }
    await assertUsableFile(input.fileId, user.id, { id: input.id, file: existing.file });
    const doc = toDocument(input);
    const received = await receivedOn(existing._id);
    if (doc.total < received) {
      throw new AppError(
        `${formatCurrency(received, { exact: true })} has already been received against this invoice, more than the new total of ${formatCurrency(doc.total, { exact: true })}.`,
        "conflict",
        { lines: ["The total is less than what was received"] },
      );
    }
    // An empty number on edit keeps the current one.
    const number = input.number ?? existing.number;
    if (number !== existing.number) await assertNumberFree(number, input.id);
    // Only the form's fields change; anything else on the invoice is kept.
    await Invoice.updateOne(
      { _id: existing._id },
      {
        $set: { ...doc, number },
        $unset: {
          ...(doc.clientGstin ? {} : { clientGstin: 1 }),
          ...(doc.project ? {} : { project: 1 }),
          ...(doc.dueDate ? {} : { dueDate: 1 }),
          ...(doc.notes ? {} : { notes: 1 }),
          ...(doc.file ? {} : { file: 1 }),
        },
      },
    );
    if (existing.file && String(existing.file) !== input.fileId) await removeFile(String(existing.file));
    if (input.fileId) await attachFiles([input.fileId], { type: "invoice", id: input.id }, null);
    await auditSafely(async () => {
      const after = await Invoice.findById(existing._id).lean();
      return after ? invoiceEdited(existing, after) : null;
    });
    return { id: input.id, number };
  },
  { revalidate: REVALIDATE, message: "Invoice updated", permission: "finance.invoices:edit" },
);

export const cancelInvoice = defineAction(
  invoiceIdSchema,
  async ({ id }) => {
    const existing = await Invoice.findById(id, { number: 1, status: 1, client: 1 }).lean();
    if (!existing) throw notFound("The invoice");
    if (await Income.exists({ invoice: existing._id })) {
      throw new AppError(`Payments are recorded against ${existing.number}. Remove those links before cancelling it.`, "conflict");
    }
    await Invoice.updateOne({ _id: existing._id }, { $set: { status: "cancelled" } });
    if (existing.status !== "cancelled") await auditSafely(() => invoiceStatus(existing, "cancelled"));
    return { id, number: existing.number };
  },
  // Cancelling and restoring were admin-only, like deleting.
  { revalidate: REVALIDATE, message: "Invoice cancelled", permission: "finance.invoices:delete" },
);

export const restoreInvoice = defineAction(
  invoiceIdSchema,
  async ({ id }) => {
    const existing = await Invoice.findById(id, { number: 1, status: 1, client: 1 }).lean();
    if (!existing) throw notFound("The invoice");
    await Invoice.updateOne({ _id: existing._id }, { $set: { status: "issued" } });
    if (existing.status === "cancelled") await auditSafely(() => invoiceStatus(existing, "restored"));
    return { id, number: existing.number };
  },
  { revalidate: REVALIDATE, message: "Invoice restored", permission: "finance.invoices:delete" },
);

export const deleteInvoice = defineAction(
  invoiceIdSchema,
  async ({ id }) => {
    const existing = await Invoice.findById(id, { number: 1, file: 1, client: 1, total: 1, date: 1 }).lean();
    if (!existing) throw notFound("The invoice");
    if (await Income.exists({ invoice: existing._id })) {
      throw new AppError(`Payments are linked to ${existing.number}. Remove those links before deleting it, or cancel it instead.`, "conflict");
    }
    await Invoice.deleteOne({ _id: existing._id });
    if (existing.file) await removeFile(String(existing.file));
    await auditSafely(() => invoiceStatus(existing, "deleted"));
    return { id, number: existing.number };
  },
  { revalidate: REVALIDATE, message: "Invoice deleted", permission: "finance.invoices:delete" },
);

/** Records a payment received against an invoice: a new income record linked to it. */
export const recordInvoiceReceipt = defineAction(
  invoiceReceiptSchema,
  async (input, user) => {
    const existing = await Invoice.findById(input.invoiceId, { client: 1, project: 1 }).lean();
    if (!existing) throw notFound("The invoice");
    const invoice = await assertReceiptLink({
      invoiceId: input.invoiceId,
      client: existing.client,
      projectId: existing.project ? String(existing.project) : null,
      amount: input.amount,
      allowOverpayment: input.allowOverpayment,
    });
    await assertAccount(input.accountId);
    const date = fromDateInput(input.date);
    const number = await nextNumber("income", undefined, date);
    const created = await Income.create({
      number,
      client: invoice.client,
      project: invoice.project ?? undefined,
      category: input.category,
      amount: round2(input.amount),
      date,
      paymentMethod: input.paymentMethod,
      account: input.accountId ? new Types.ObjectId(input.accountId) : undefined,
      reference: input.reference,
      notes: input.notes,
      invoice: invoice._id,
      createdBy: new Types.ObjectId(user.id),
    });
    await auditSafely(() => incomeCreated(created.toObject(), { ref: { invoice: String(invoice._id) } }));
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Payment recorded", permission: "finance.invoices:edit" },
);

/** Why a receipt may not settle an invoice, or null. Shared by "Apply advance" and "Create invoice for a receipt". */
function receiptBlock(income: { number: string; invoice?: unknown; paymentMethod: string; date: Date }): AppError | null {
  if (income.invoice) return new AppError(`${income.number} is already linked to an invoice.`, "conflict");
  // The books skip records "From stock" (no money moved), so one could not settle the invoice there.
  if (income.paymentMethod === "stock") return new AppError(`${income.number} moved no money, so it cannot settle an invoice.`, "invalid");
  // "On credit" is not money received either.
  if (income.paymentMethod === "credit") return new AppError(`${income.number} is on credit, not money received, so it cannot settle an invoice.`, "invalid");
  if (income.date.getTime() > endOfDayIST(new Date()).getTime()) {
    return new AppError(`${income.number} is dated later than today, so it cannot settle an invoice yet.`, "invalid");
  }
  return null;
}

const RECEIPT_FIELDS = { number: 1, client: 1, project: 1, amount: 1, invoice: 1, paymentMethod: 1, date: 1 } as const;

/** Links the receipt to the invoice: the receipt rules, the invoice link rules, then a conditional write. */
async function linkReceipt(incomeId: string, invoiceId: string, allowOverpayment?: boolean) {
  const income = await Income.findById(incomeId, RECEIPT_FIELDS).lean();
  if (!income) throw notFound("The income record");
  const blocked = receiptBlock(income);
  if (blocked) throw blocked;
  const invoice = await assertReceiptLink({
    invoiceId,
    client: income.client,
    projectId: income.project ? String(income.project) : null,
    amount: income.amount,
    allowOverpayment,
  });
  // Only if still unlinked: two people applying the same advance at once must not both succeed.
  const done = await Income.updateOne({ _id: income._id, invoice: null }, { $set: { invoice: invoice._id } });
  if (!done.modifiedCount) throw new AppError(`${income.number} was linked to an invoice meanwhile.`, "conflict");
  await auditSafely(() => receiptLink(income, invoice, "linked"));
  return { id: invoiceId, number: income.number };
}

/** Links an existing receipt (usually an advance) to an invoice, so it settles the invoice instead of counting on its own. */
export const applyReceiptToInvoice = defineAction(
  applyReceiptSchema,
  async (input) => linkReceipt(input.incomeId, input.invoiceId, input.allowOverpayment),
  { revalidate: REVALIDATE, message: "Receipt applied to the invoice", permission: "finance.invoices:edit" },
);

/**
 * Creates an invoice for a receipt that has none (the "No invoice" flag on the income list) and
 * links the receipt to it in one step. A new invoice posts revenue by itself, so one that is not
 * linked to the receipt would count the sale twice: if the link fails, the new invoice is removed
 * again and nothing is kept. Nothing is created for a receipt that may not settle an invoice.
 */
export const createInvoiceForReceipt = defineAction(
  invoiceFormSchema.and(createForReceiptSchema),
  async (input, user) => {
    // Linking a receipt to an invoice is an invoices edit (as Apply advance is) and needs the receipt to be visible.
    if (!can(user, "finance.income:view") || !can(user, "finance.invoices:edit")) {
      throw new AppError("You do not have permission to link a receipt to an invoice.", "forbidden");
    }
    const { incomeId, ...form } = input;
    await assertUsableFile(form.fileId, user.id);
    const income = await Income.findById(incomeId, RECEIPT_FIELDS).lean();
    if (!income) throw notFound("The income record");
    const blocked = receiptBlock(income);
    if (blocked) throw blocked;
    const sameClient = exactName(income.client).test(form.client.trim());
    const sameProject = Boolean(income.project && form.projectId && String(income.project) === form.projectId);
    if (!sameClient && !sameProject) {
      throw new AppError(`The invoice must be to ${income.client}, the customer on ${income.number}.`, "invalid", { client: ["Must match the receipt's customer"] });
    }
    const doc = toDocument(form);
    if (doc.total < income.amount) {
      throw new AppError(
        `The invoice total ${formatCurrency(doc.total, { exact: true })} is less than the receipt ${formatCurrency(income.amount, { exact: true })}. Make the invoice at least that much.`,
        "conflict",
        { lines: ["The total is less than the receipt"] },
      );
    }
    if (form.number) await assertNumberFree(form.number);
    const number = form.number ?? (await freeInvoiceNumber(doc.date));
    const created = await Invoice.create({ ...doc, number, status: "issued", createdBy: new Types.ObjectId(user.id) });
    try {
      // Logged before the link, so the trail reads: invoice made, then the receipt applied to it.
      await auditSafely(() => invoiceCreated(created.toObject(), { note: `Made for receipt ${income.number}`, ref: { income: incomeId } }));
      await linkReceipt(incomeId, String(created._id), false);
    } catch (error) {
      try {
        // Keep it if another receipt was recorded against it meanwhile: deleting it would leave that receipt pointing at nothing.
        if (await Income.exists({ invoice: created._id })) console.error(`[invoices] kept ${number}: a receipt was linked to it before its own receipt could be`);
        else {
          await Invoice.deleteOne({ _id: created._id });
          await auditSafely(() => ({ ...invoiceStatus(created, "deleted"), note: "Removed again: the receipt could not be linked to it" }));
        }
      } catch (cleanup) {
        console.error(`[invoices] could not remove ${number} after its receipt link failed`, cleanup);
      }
      throw error;
    }
    if (form.fileId) await attachFiles([form.fileId], { type: "invoice", id: String(created._id) }, null);
    return { id: String(created._id), number };
  },
  { revalidate: REVALIDATE, message: "Invoice created and linked to the receipt", permission: "finance.invoices:create" },
);


export type InvoicePrefill = { incomeId: string; incomeNumber: string; client: string; projectId: string | null; date: string; amount: number };

/** What the invoice form starts with for "Create invoice" on a receipt, or why it cannot be made (error). */
export async function fetchInvoicePrefill(raw: z.input<typeof prefillInput>): Promise<{ ok: true; prefill: InvoicePrefill } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.invoices:create") || !can(user, "finance.invoices:edit") || !can(user, "finance.income:view")) {
    return { ok: false, error: "You do not have permission to create an invoice for a receipt." };
  }
  const parsed = prefillInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That receipt was not found." };
  await connectDB();
  const income = await Income.findById(parsed.data.incomeId, RECEIPT_FIELDS).lean();
  if (!income) return { ok: false, error: "That receipt no longer exists." };
  const blocked = receiptBlock(income);
  if (blocked) return { ok: false, error: blocked.message };
  return {
    ok: true,
    prefill: {
      incomeId: String(income._id),
      incomeNumber: income.number,
      client: income.client,
      projectId: income.project ? String(income.project) : null,
      // The invoice is dated the receipt's day, so the sale stays in the period it was received in.
      date: toDateInput(income.date),
      amount: income.amount,
    },
  };
}

/** Removes a receipt's link to its invoice. The receipt then counts as income of its own category again. */
export const unlinkReceipt = defineAction(
  unlinkReceiptSchema,
  async ({ incomeId }) => {
    const income = await Income.findById(incomeId, { number: 1, invoice: 1, client: 1 }).lean();
    if (!income) throw notFound("The income record");
    if (income.invoice) {
      await Income.updateOne({ _id: income._id }, { $unset: { invoice: 1 } });
      const invoiceId = income.invoice;
      await auditSafely(async () => {
        const invoice = await Invoice.findById(invoiceId, { number: 1, client: 1 }).lean();
        return invoice ? receiptLink(income, invoice, "unlinked") : null;
      });
    }
    return { id: incomeId, number: income.number };
  },
  { revalidate: REVALIDATE, message: "Link removed", permission: "finance.invoices:edit" },
);

/** Loads one invoice for the detail drawer / edit form. */
export async function fetchInvoice(id: string): Promise<InvoiceDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.invoices:view")) return null;
  return getInvoice(id);
}

const openInvoicesInput = z.object({ client: z.string().max(200).optional(), projectId: optionalObjectId, excludeIncomeId: optionalObjectId });

/** Open invoices of a client or project, for the income form's "Settles invoice" picker. */
export async function fetchOpenInvoices(raw: z.input<typeof openInvoicesInput>): Promise<OpenInvoiceOption[]> {
  const user = await getCurrentUser();
  // The income form asks for these, so recording or editing income is enough.
  if (!user || !["finance.invoices:view", "finance.income:create", "finance.income:edit"].some((p) => can(user, p))) return [];
  const parsed = openInvoicesInput.safeParse(raw);
  if (!parsed.success) return [];
  return openInvoicesFor(parsed.data);
}

/** Receipts of the invoice's client that are not linked to any invoice yet. */
export async function fetchUnlinkedReceipts(invoiceId: string): Promise<UnlinkedReceipt[]> {
  const user = await getCurrentUser();
  if (!user || !can(user, "finance.invoices:edit") || !objectId.safeParse(invoiceId).success) return [];
  await connectDB();
  const invoice = await Invoice.findById(invoiceId, { client: 1, project: 1 }).lean();
  if (!invoice) return [];
  return unlinkedReceiptsFor(invoice.client, invoice.project ? String(invoice.project) : null);
}

/** Removes an uploaded invoice file that was never saved with an invoice (form cancelled or file replaced). */
export async function discardUnsavedInvoiceFile(fileId: string) {
  const user = await getCurrentUser();
  if (!user || !Types.ObjectId.isValid(fileId)) return;
  await connectDB();
  const file = await FileModel.findById(fileId).lean();
  if (file && !file.entity?.id && String(file.uploadedBy) === user.id) await removeFile(fileId);
}
