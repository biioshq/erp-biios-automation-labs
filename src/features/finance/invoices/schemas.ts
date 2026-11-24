import { z } from "zod";
import { INCOME_CATEGORIES, PAYMENT_METHODS, valuesOf } from "@/lib/constants";
import { dateInput, gstin, money, objectId, optionalDateInput, optionalObjectId, optionalText, positiveMoney, requiredText } from "@/lib/zod";
import { toDateInput } from "@/lib/dates";
import { GST_RATES } from "./totals";

/** Validation shared by the invoice forms (client) and the invoice actions (server). Client-safe. */

export const invoiceLineSchema = z.object({
  description: requiredText("Description", 500),
  quantity: z.number({ error: "Enter a quantity" }).finite().positive("Must be more than zero").max(1e7, "That quantity is too large"),
  rate: money,
  gstRate: z
    .number({ error: "Pick a GST rate" })
    .refine((v) => (GST_RATES as readonly number[]).includes(v), "Pick a GST rate"),
  hsnSac: optionalText(20),
});

export const invoiceFormSchema = z
  .object({
    /** Empty: the next number in the INV sequence is used. */
    number: optionalText(60),
    client: requiredText("Customer", 200),
    clientGstin: gstin,
    projectId: optionalObjectId,
    date: dateInput,
    dueDate: optionalDateInput,
    interState: z.boolean(),
    lines: z.array(invoiceLineSchema).min(1, "Add at least one line").max(100, "At most 100 lines"),
    notes: optionalText(4000),
    fileId: optionalObjectId,
  })
  .superRefine((v, ctx) => {
    if (v.dueDate && v.dueDate < v.date) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date is before the invoice date" });
    }
  });

export type InvoiceFormInput = z.input<typeof invoiceFormSchema>;
export type InvoiceFormValues = z.output<typeof invoiceFormSchema>;

export const invoiceIdSchema = z.object({ id: objectId });

/** Methods a customer can pay with ("From stock" and "On credit" move no money in). */
export const RECEIPT_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "stock" && m.value !== "credit");

/** "Record payment received" on an invoice: creates an income record linked to it. */
export const invoiceReceiptSchema = z.object({
  invoiceId: objectId,
  amount: positiveMoney,
  // Money received cannot be dated later than today. The books count a receipt from its date, so a
  // future one would show the invoice as paid while the balance sheet still shows it as owed.
  date: dateInput.refine((v) => v <= toDateInput(new Date()), "Cannot be later than today"),
  category: z.enum(valuesOf(INCOME_CATEGORIES), { error: "Pick a category" }),
  paymentMethod: z
    .enum(valuesOf(PAYMENT_METHODS), { error: "Pick a payment method" })
    .refine((m) => m !== "stock" && m !== "credit", "Pick how the money was received"),
  accountId: optionalObjectId,
  reference: optionalText(120),
  notes: optionalText(4000),
  /** Set after the person confirmed that the amount is more than what is outstanding. */
  allowOverpayment: z.boolean().optional(),
});
export type InvoiceReceiptInput = z.input<typeof invoiceReceiptSchema>;
export type InvoiceReceiptValues = z.output<typeof invoiceReceiptSchema>;

/** Field key the actions use to say "the amount is more than is outstanding; confirm to save". */
export const OVERPAYMENT_FIELD = "allowOverpayment";

/** Link an existing receipt (an advance) to an invoice, or remove that link. */
export const applyReceiptSchema = z.object({
  invoiceId: objectId,
  incomeId: objectId,
  allowOverpayment: z.boolean().optional(),
});
export const unlinkReceiptSchema = z.object({ incomeId: objectId });

/** Filter keys accepted in the URL of the invoice list. */
export const INVOICE_FILTER_KEYS = ["status", "client", "project"] as const;
export const INVOICE_SORT_KEYS = ["date", "dueDate", "total", "outstanding", "client", "number"] as const;
/** Filter keys of the "Payments received" tab. */
export const INVOICE_PAYMENT_FILTER_KEYS = ["client", "paymentMethod"] as const;
export const INVOICE_PAYMENT_SORT_KEYS = ["date", "amount", "client"] as const;

/** Statuses the list can filter by: the payment status, or cancelled. */
export const INVOICE_LIST_STATUSES = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Partly paid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number]["value"];
