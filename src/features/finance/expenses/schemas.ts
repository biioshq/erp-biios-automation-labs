import { z } from "zod";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PROJECT_STAGES, valuesOf } from "@/lib/constants";
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
import { gstGrandTotal } from "@/lib/gst";

/** Validation shared by the expense form (client) and the expense actions (server). Client-safe. */

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
    category: z.enum(valuesOf(EXPENSE_CATEGORIES), { error: "Pick a category" }),
    description: optionalText(1000),
    amount: positiveMoney,
    date: dateInput,
    paymentMethod: z.enum(valuesOf(PAYMENT_METHODS), { error: "Pick a payment method" }),
    notes: optionalText(4000),
    gst: gstSchema,
    receiptId: optionalObjectId,
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
    const g = v.gst;
    if ((g.igst ?? 0) > 0 && ((g.cgst ?? 0) > 0 || (g.sgst ?? 0) > 0)) {
      ctx.addIssue({ code: "custom", path: ["gst", "igst"], message: "Use IGST or CGST + SGST, not both" });
    }
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
export const EXPENSE_FILTER_KEYS = ["category", "project", "stage", "paymentMethod", "source", "vendor"] as const;
export const EXPENSE_SORT_KEYS = ["date", "amount", "vendor", "number", "category", "createdAt"] as const;
