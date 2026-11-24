import { z } from "zod";
import { INCOME_CATEGORIES, PAYMENT_METHODS, valuesOf } from "@/lib/constants";
import { dateInput, objectId, optionalObjectId, optionalText, positiveMoney, requiredText } from "@/lib/zod";

/** Validation shared by the income form (client) and the income actions (server). Client-safe. */

export const incomeFormSchema = z
  .object({
    client: requiredText("Client", 200),
    projectId: optionalObjectId,
    category: z.enum(valuesOf(INCOME_CATEGORIES), { error: "Pick a category" }),
    amount: positiveMoney,
    date: dateInput,
    paymentMethod: z.enum(valuesOf(PAYMENT_METHODS), { error: "Pick a payment method" }),
    reference: optionalText(120),
    notes: optionalText(4000),
    receiptId: optionalObjectId,
    /** The bank or cash account it came into; empty = the default account for the payment method. */
    accountId: optionalObjectId,
    /** The invoice this receipt settles. A linked receipt is not counted as revenue again. */
    invoiceId: optionalObjectId,
    /** Set after the person confirmed recording more than the invoice's outstanding amount. */
    allowOverpayment: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.paymentMethod === "stock") {
      ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Pick how the money was received" });
    }
  });

export type IncomeFormInput = z.input<typeof incomeFormSchema>;
export type IncomeFormValues = z.output<typeof incomeFormSchema>;

export const incomeIdSchema = z.object({ id: objectId });

/** Filter keys accepted in the URL of the income list. */
export const INCOME_FILTER_KEYS = ["category", "project", "paymentMethod", "invoice"] as const;
/** Values of the "invoice" filter. */
export const INCOME_INVOICE_FILTER = [
  { value: "linked", label: "Settles an invoice" },
  { value: "unlinked", label: "Not linked" },
] as const;
export const INCOME_SORT_KEYS = ["date", "amount", "client", "number", "createdAt"] as const;
