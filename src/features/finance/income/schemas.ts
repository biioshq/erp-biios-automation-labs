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
export const INCOME_FILTER_KEYS = ["category", "project", "paymentMethod"] as const;
export const INCOME_SORT_KEYS = ["date", "amount", "client", "number", "createdAt"] as const;
