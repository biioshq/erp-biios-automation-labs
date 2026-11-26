import { z } from "zod";
import { DEPARTMENTS, EXPENSE_NATURES, PAYMENT_METHODS, PAYMENT_STATUSES, PROJECT_STAGES, valuesOf } from "@/lib/constants";
import { expenseCategoryLabelSchema, expenseCategoryValueSchema } from "@/lib/expense-categories";
import {
  dateInput,
  gstin,
  money,
  objectId,
  optionalDateInput,
  optionalMoney,
  optionalObjectId,
  optionalText,
  positiveMoney,
  requiredText,
} from "@/lib/zod";
import { gstGrandTotal, gstIssues } from "@/lib/gst";

/** Validation shared by the expense form (client) and the expense actions (server). Client-safe. */

/**
 * How much of an expense was paid when it was recorded. "full" is how every expense worked before
 * part payments; "partial" stores the amount paid now as the first payment; "none" is "On credit".
 */
export const EXPENSE_PAYMENT_MODES = [
  { value: "full", label: "Paid in full" },
  { value: "partial", label: "Partly paid" },
  { value: "none", label: "Not paid yet" },
] as const;
export type ExpensePaymentMode = (typeof EXPENSE_PAYMENT_MODES)[number]["value"];

/** Methods a real payment can use: "On credit" means unpaid, and "From stock" is written by inventory. */
export const PAYING_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "credit" && m.value !== "stock");
const payingMethod = z
  .enum(valuesOf(PAYMENT_METHODS), { error: "Pick a payment method" })
  .refine((m) => m !== "credit" && m !== "stock", "Pick how it was paid");

/**
 * The payment mode a form submission means. Callers that send no mode (CSV import, receipt import)
 * keep the old meaning: "On credit" is unpaid, any other method is paid in full on the expense date.
 */
export function resolvePaymentMode(v: { payment?: ExpensePaymentMode; paymentMethod: string }): ExpensePaymentMode {
  return v.payment ?? (v.paymentMethod === "credit" ? "none" : "full");
}

export const gstSchema = z.object({
  gstin,
  invoiceNumber: optionalText(60),
  invoiceDate: optionalDateInput,
  taxableAmount: optionalMoney,
  cgst: optionalMoney,
  sgst: optionalMoney,
  igst: optionalMoney,
  cess: optionalMoney,
  hsnSac: optionalText(120),
  grandTotal: optionalMoney,
});

export const expenseFormSchema = z
  .object({
    vendor: requiredText("Vendor", 200),
    vendorAddress: optionalText(500),
    projectId: optionalObjectId,
    stage: z.enum(valuesOf(PROJECT_STAGES)).optional(),
    /** Built-in or custom; the actions check it is a known, visible category (or the record's current one). */
    category: expenseCategoryValueSchema,
    description: optionalText(1000),
    amount: positiveMoney,
    date: dateInput,
    paymentMethod: z.enum(valuesOf(PAYMENT_METHODS), { error: "Pick a payment method" }),
    notes: optionalText(4000),
    gst: gstSchema,
    receiptId: optionalObjectId,
    /** Optional everywhere, so imports that send none behave as before (see resolvePaymentMode). */
    payment: z.enum(["full", "partial", "none"]).optional(),
    /** Partly paid: the amount paid on the expense date. */
    paidAmount: optionalMoney,
    /** "Paid from": the bank or cash account, when paid in full or in part. Empty = the default account for the method. */
    accountId: optionalObjectId,
    /** When the unpaid part falls due. */
    dueDate: optionalDateInput,
    department: z.enum(valuesOf(DEPARTMENTS)).optional(),
    /** Paid in advance for a period: both days or neither. */
    prepaidFrom: optionalDateInput,
    prepaidTo: optionalDateInput,
    ocr: z
      .object({ overall: money.max(1), source: z.string().max(20), fields: z.record(z.string(), z.number().min(0).max(1)) })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.projectId && !v.stage) {
      ctx.addIssue({ code: "custom", path: ["stage"], message: "Every project expense belongs to a stage" });
    }
    if (v.paymentMethod === "stock") {
      ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Stock expenses are created by assigning inventory" });
    }
    if (v.payment === "full" || v.payment === "partial") {
      if (v.paymentMethod === "credit") {
        ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "On credit means not paid yet. Pick how it was paid." });
      }
    }
    if (v.payment === "partial") {
      const paid = v.paidAmount ?? 0;
      if (paid <= 0) ctx.addIssue({ code: "custom", path: ["paidAmount"], message: "Enter the amount paid now" });
      else if (paid >= v.amount - 0.005) {
        ctx.addIssue({ code: "custom", path: ["paidAmount"], message: "That is the whole amount. Pick Paid in full instead." });
      }
    }
    if ((v.payment === "partial" || v.payment === "none") && !v.dueDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "When is the rest due?" });
    }
    if (Boolean(v.prepaidFrom) !== Boolean(v.prepaidTo)) {
      ctx.addIssue({ code: "custom", path: [v.prepaidFrom ? "prepaidTo" : "prepaidFrom"], message: "Pick both the first and the last day" });
    } else if (v.prepaidFrom && v.prepaidTo && v.prepaidTo < v.prepaidFrom) {
      ctx.addIssue({ code: "custom", path: ["prepaidTo"], message: "The last day is before the first" });
    }
    const g = v.gst;
    for (const issue of gstIssues(g)) ctx.addIssue({ code: "custom", path: ["gst", issue.field], message: issue.message });
    if ((g.taxableAmount ?? 0) > 0) {
      const expected = gstGrandTotal(g);
      if (Math.abs(expected - v.amount) > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: `Taxable value plus GST is ₹${expected.toLocaleString("en-IN")}. Amount should match.`,
        });
      }
    }
  });

export type ExpenseFormInput = z.input<typeof expenseFormSchema>;
export type ExpenseFormValues = z.output<typeof expenseFormSchema>;

export const expenseIdSchema = z.object({ id: objectId });

/** Filter keys accepted in the URL of the expenses list. */
export const EXPENSE_FILTER_KEYS = ["category", "project", "stage", "paymentMethod", "source", "vendor", "status", "nature", "department", "bank"] as const;

/** The list's "From bank statement" filter: expenses that came from, or were paid through, a statement line. */
export const EXPENSE_BANK_FILTER_OPTIONS = [{ value: "yes", label: "From bank statement" }] as const;

/** Values of the list's status, nature and department filters ("none" = no department). */
export const EXPENSE_STATUS_FILTER_VALUES = valuesOf(PAYMENT_STATUSES);
export const EXPENSE_NATURE_FILTER_VALUES = valuesOf(EXPENSE_NATURES);

/** Recording a payment against an expense (Outstanding payments and the expense drawer). */
export const expensePaymentSchema = z.object({
  id: objectId,
  date: dateInput,
  amount: positiveMoney,
  paymentMethod: payingMethod,
  accountId: optionalObjectId,
  reference: optionalText(120),
  note: optionalText(1000),
});
export type ExpensePaymentInput = z.input<typeof expensePaymentSchema>;

export const expensePaymentIdSchema = z.object({ id: objectId, paymentId: objectId });

/** Mark as paid (Outstanding payments): the same fields as Record payment, prefilled by the page. */
export const markExpensePaidSchema = expensePaymentSchema;

/** Most rows one Mark selected as paid, or one Undo, can take. */
export const MAX_BULK_PAYMENTS = 100;

/** Mark selected as paid: each expense is paid what it still owes, on one day from one account. */
export const markExpensesPaidSchema = z.object({
  ids: z.array(objectId).min(1, "Pick at least one expense").max(MAX_BULK_PAYMENTS, `At most ${MAX_BULK_PAYMENTS} at a time`),
  date: dateInput,
  paymentMethod: payingMethod,
  accountId: optionalObjectId,
  reference: optionalText(120),
  note: optionalText(1000),
});

/** Undo right after Mark as paid: the payments it recorded. */
export const undoExpensePaymentsSchema = z.object({
  payments: z.array(expensePaymentIdSchema).min(1).max(MAX_BULK_PAYMENTS),
});
export const EXPENSE_SORT_KEYS = ["date", "amount", "vendor", "number", "category", "createdAt"] as const;

/** Managing categories (admins, from the Expenses page). */
export const expenseCategoryCreateSchema = z.object({ label: expenseCategoryLabelSchema });
export const expenseCategoryRenameSchema = z.object({ value: expenseCategoryValueSchema, label: expenseCategoryLabelSchema });
export const expenseCategoryHiddenSchema = z.object({ value: expenseCategoryValueSchema, hidden: z.boolean() });
export const expenseCategoryValueOnlySchema = z.object({ value: expenseCategoryValueSchema });
export const expenseCategoryNatureSchema = z.object({ value: expenseCategoryValueSchema, nature: z.enum(valuesOf(EXPENSE_NATURES)) });
