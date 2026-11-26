import "server-only";

import type { Types } from "mongoose";
import { diffSnapshots, snapshotChanges, type AuditChange, type AuditEntry } from "@/server/audit";
import { formatCurrency, round2 } from "@/lib/format";
import { totalTax } from "@/lib/gst";
import { paymentState } from "@/lib/payments";

/**
 * What the audit trail records about expenses, income and invoices: a flat snapshot of the fields
 * people edit, compared before and after a change. Only small values go in (see auditValue).
 */

type Id = Types.ObjectId | string;
type Gst = { gstin?: string | null; invoiceNumber?: string | null; taxableAmount?: number | null; cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null } | null;

type ExpenseLike = {
  _id: Id;
  number: string;
  vendor: string;
  vendorAddress?: string | null;
  description?: string | null;
  amount: number;
  date: Date;
  dueDate?: Date | null;
  category: string;
  project?: unknown;
  stage?: string | null;
  paymentMethod?: string | null;
  account?: unknown;
  department?: string | null;
  notes?: string | null;
  gst?: Gst;
  receipt?: unknown;
  prepaid?: { from?: Date | null; to?: Date | null } | null;
  payments?: { date: Date; amount: number; paymentMethod?: string | null }[] | null;
};

export const isSalary = (...categories: (string | null | undefined)[]) => categories.includes("salaries");

export const expenseLabel = (e: { number: string; vendor: string }) => `${e.number} · ${e.vendor}`;

export function expenseSnapshot(e: ExpenseLike): Record<string, unknown> {
  const g = e.gst ?? null;
  return {
    vendor: e.vendor,
    vendorAddress: e.vendorAddress,
    description: e.description,
    amount: e.amount,
    date: e.date,
    dueDate: e.dueDate,
    category: e.category,
    project: e.project,
    stage: e.stage,
    department: e.department,
    paymentMethod: e.paymentMethod,
    account: e.account,
    // What is paid so far, by the shared rule (no payments list: paid in full unless On credit).
    paid: paymentState({ amount: e.amount, date: e.date, paymentMethod: e.paymentMethod ?? "", payments: e.payments?.map((p) => ({ ...p, paymentMethod: p.paymentMethod ?? "" })) }).paid,
    gstin: g?.gstin,
    invoiceNumber: g?.invoiceNumber,
    taxableAmount: g ? round2(g.taxableAmount ?? 0) : null,
    tax: g ? round2(totalTax(g)) : null,
    prepaidFrom: e.prepaid?.from,
    prepaidTo: e.prepaid?.to,
    receipt: Boolean(e.receipt),
    notes: e.notes,
  };
}

/** What a new or deleted expense is remembered by. */
const EXPENSE_KEY_FIELDS = ["vendor", "description", "amount", "date", "dueDate", "category", "project", "stage", "paymentMethod", "account", "paid"];

const pick = (snap: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.map((f) => [f, snap[f]]));

/** Classification only: a change of these alone reads "Reclassified". */
const CLASSIFICATION = new Set(["category", "project", "stage", "department"]);
const editAction = (changes: AuditChange[]) => (changes.length && changes.every((c) => CLASSIFICATION.has(c.field)) ? "categorised" : "edited");

export function expenseCreated(e: ExpenseLike, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: "created",
    entity: { type: "expense", id: e._id, label: expenseLabel(e) },
    changes: snapshotChanges(pick(expenseSnapshot(e), EXPENSE_KEY_FIELDS), "to"),
    salary: isSalary(e.category),
    ...extra,
  };
}

/** Null when nothing the trail records changed (a save with no edits). */
export function expenseEdited(before: ExpenseLike, after: ExpenseLike): AuditEntry | null {
  const changes = diffSnapshots(expenseSnapshot(before), expenseSnapshot(after));
  if (!changes.length) return null;
  return {
    action: editAction(changes),
    entity: { type: "expense", id: after._id, label: expenseLabel(after) },
    changes,
    salary: isSalary(before.category, after.category),
  };
}

export function expenseDeleted(e: ExpenseLike): AuditEntry {
  return {
    action: "deleted",
    entity: { type: "expense", id: e._id, label: expenseLabel(e) },
    changes: snapshotChanges(pick(expenseSnapshot(e), EXPENSE_KEY_FIELDS), "from"),
    salary: isSalary(e.category),
  };
}

type PaymentLike = { _id?: Id; date: Date; amount: number; paymentMethod?: string | null; account?: unknown };

const owedNote = (outstanding: number | undefined) =>
  outstanding === undefined ? null : outstanding > 0.005 ? `${formatCurrency(outstanding, { exact: true })} still owed` : "Paid in full";

export function expensePaid(
  e: { _id: Id; number: string; vendor: string; category: string },
  p: PaymentLike,
  extra: { outstanding?: number; source?: AuditEntry["source"]; ref?: AuditEntry["ref"]; note?: string } = {},
): AuditEntry {
  return {
    action: "paid",
    entity: { type: "expense", id: e._id, label: expenseLabel(e) },
    changes: snapshotChanges({ paidAmount: p.amount, paidOn: p.date, paymentMethod: p.paymentMethod, account: p.account }, "to"),
    salary: isSalary(e.category),
    ref: { payment: p._id ? String(p._id) : undefined, ...extra.ref },
    note: [owedNote(extra.outstanding), extra.note].filter(Boolean).join(". ") || null,
    ...(extra.source ? { source: extra.source } : {}),
  };
}

export function expensePaymentRemoved(e: { _id: Id; number: string; vendor: string; category: string }, p: PaymentLike, note?: string): AuditEntry {
  return {
    action: "payment_removed",
    entity: { type: "expense", id: e._id, label: expenseLabel(e) },
    changes: snapshotChanges({ paidAmount: p.amount, paidOn: p.date, paymentMethod: p.paymentMethod, account: p.account }, "from"),
    salary: isSalary(e.category),
    ref: { payment: p._id ? String(p._id) : undefined },
    note: note ?? null,
  };
}

type IncomeLike = {
  _id: Id;
  number: string;
  client: string;
  project?: unknown;
  category: string;
  amount: number;
  date: Date;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
  account?: unknown;
  invoice?: unknown;
  receipt?: unknown;
};

export const incomeLabel = (i: { number: string; client: string }) => `${i.number} · ${i.client}`;

export function incomeSnapshot(i: IncomeLike): Record<string, unknown> {
  return {
    client: i.client,
    amount: i.amount,
    date: i.date,
    incomeCategory: i.category,
    project: i.project,
    paymentMethod: i.paymentMethod,
    account: i.account,
    reference: i.reference,
    invoice: i.invoice,
    receipt: Boolean(i.receipt),
    notes: i.notes,
  };
}

const INCOME_KEY_FIELDS = ["client", "amount", "date", "incomeCategory", "project", "paymentMethod", "account", "invoice"];
const INCOME_CLASSIFICATION = new Set(["incomeCategory", "project"]);

export function incomeCreated(i: IncomeLike, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: "created",
    entity: { type: "income", id: i._id, label: incomeLabel(i) },
    changes: snapshotChanges(pick(incomeSnapshot(i), INCOME_KEY_FIELDS), "to"),
    ...extra,
  };
}

export function incomeEdited(before: IncomeLike, after: IncomeLike): AuditEntry | null {
  const changes = diffSnapshots(incomeSnapshot(before), incomeSnapshot(after));
  if (!changes.length) return null;
  return {
    action: changes.every((c) => INCOME_CLASSIFICATION.has(c.field)) ? "categorised" : "edited",
    entity: { type: "income", id: after._id, label: incomeLabel(after) },
    changes,
  };
}

export function incomeDeleted(i: IncomeLike): AuditEntry {
  return {
    action: "deleted",
    entity: { type: "income", id: i._id, label: incomeLabel(i) },
    changes: snapshotChanges(pick(incomeSnapshot(i), INCOME_KEY_FIELDS), "from"),
  };
}

type InvoiceLike = {
  _id: Id;
  number: string;
  client: string;
  clientGstin?: string | null;
  project?: unknown;
  date: Date;
  dueDate?: Date | null;
  interState?: boolean | null;
  lines?: unknown[] | null;
  taxableAmount?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  total: number;
  notes?: string | null;
  file?: unknown;
  status?: string | null;
};

export const invoiceLabel = (i: { number: string; client: string }) => `${i.number} · ${i.client}`;

export function invoiceSnapshot(i: InvoiceLike): Record<string, unknown> {
  return {
    number: i.number,
    client: i.client,
    clientGstin: i.clientGstin,
    project: i.project,
    date: i.date,
    dueDate: i.dueDate,
    interState: Boolean(i.interState),
    lines: i.lines ? `${i.lines.length} line${i.lines.length === 1 ? "" : "s"}` : null,
    taxableAmount: i.taxableAmount,
    tax: round2((i.cgst ?? 0) + (i.sgst ?? 0) + (i.igst ?? 0)),
    total: i.total,
    notes: i.notes,
    file: Boolean(i.file),
  };
}

const INVOICE_KEY_FIELDS = ["number", "client", "project", "date", "dueDate", "taxableAmount", "tax", "total"];

export function invoiceCreated(i: InvoiceLike, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: "created",
    entity: { type: "invoice", id: i._id, label: invoiceLabel(i) },
    changes: snapshotChanges(pick(invoiceSnapshot(i), INVOICE_KEY_FIELDS), "to"),
    ...extra,
  };
}

export function invoiceEdited(before: InvoiceLike, after: InvoiceLike): AuditEntry | null {
  const changes = diffSnapshots(invoiceSnapshot(before), invoiceSnapshot(after));
  // The lines may change without their count or totals changing (a reworded description).
  const linesChanged = JSON.stringify(before.lines ?? []) !== JSON.stringify(after.lines ?? []);
  if (!changes.length && !linesChanged) return null;
  return {
    action: "edited",
    entity: { type: "invoice", id: after._id, label: invoiceLabel(after) },
    changes,
    note: linesChanged && !changes.some((c) => c.field === "lines") ? "Invoice lines changed" : null,
  };
}

export function invoiceStatus(i: { _id: Id; number: string; client: string; total?: number | null; date?: Date | null }, action: "cancelled" | "restored" | "deleted"): AuditEntry {
  return {
    action,
    entity: { type: "invoice", id: i._id, label: invoiceLabel(i) },
    changes:
      action === "deleted"
        ? snapshotChanges({ total: i.total, date: i.date }, "from")
        : [{ field: "status", from: action === "cancelled" ? "Issued" : "Cancelled", to: action === "cancelled" ? "Cancelled" : "Issued" }],
  };
}

/** A receipt tied to an invoice, or untied from it: one entry on the receipt, one on the invoice. */
export function receiptLink(
  income: { _id: Id; number: string; client: string },
  invoice: { _id: Id; number: string; client: string },
  action: "linked" | "unlinked",
): AuditEntry[] {
  const change = action === "linked" ? { field: "invoice", from: null, to: invoice.number } : { field: "invoice", from: invoice.number, to: null };
  return [
    { action, entity: { type: "income", id: income._id, label: incomeLabel(income) }, changes: [change], ref: { invoice: String(invoice._id) } },
    {
      action,
      entity: { type: "invoice", id: invoice._id, label: invoiceLabel(invoice) },
      note: action === "linked" ? `Receipt ${income.number} applied` : `Receipt ${income.number} no longer applied`,
      ref: { income: String(income._id) },
    },
  ];
}
