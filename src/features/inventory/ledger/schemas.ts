import { z } from "zod";
import { PROJECT_STAGES, valuesOf } from "@/lib/constants";
import { dateInput, gstin, money, objectId, optionalDateInput, optionalMoney, optionalObjectId, optionalText, quantity } from "@/lib/zod";
import { gstGrandTotal, gstIssues } from "@/lib/gst";

/** Validation shared by the stock operation forms (client) and their actions (server). Client-safe. */

/** At most 3 decimals: the ledger rounds quantities to 3 decimals, so the form must not accept
 * more, or its preview would price a quantity other than the one recorded. */
export const hasQtyDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
export const stockQuantity = quantity.refine(hasQtyDecimals, "Use at most 3 decimals");

const pickId = (what: string) => z.string({ error: `Pick ${what}` }).regex(/^[a-f\d]{24}$/i, `Pick ${what}`);

const invoiceSchema = z.object({
  invoiceNumber: optionalText(60),
  invoiceDate: optionalDateInput,
  gstin,
  taxableAmount: optionalMoney,
  cgst: optionalMoney,
  sgst: optionalMoney,
  igst: optionalMoney,
  cess: optionalMoney,
  hsnSac: optionalText(120),
});

export const purchaseFormSchema = z
  .object({
    itemId: pickId("an item"),
    quantity: stockQuantity,
    unitPrice: money,
    vendor: optionalText(200),
    date: dateInput,
    invoice: invoiceSchema,
    receiptFileId: optionalObjectId,
    note: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    // The same tax rules as expenses: both go into the GST register and the input-credit totals.
    for (const issue of gstIssues(v.invoice)) ctx.addIssue({ code: "custom", path: ["invoice", issue.field], message: issue.message });
  });
export type PurchaseFormInput = z.input<typeof purchaseFormSchema>;
export type PurchaseFormValues = z.output<typeof purchaseFormSchema>;

export function invoiceTotal(g: PurchaseFormInput["invoice"] | undefined) {
  return gstGrandTotal(g ?? {});
}

export const assignFormSchema = z.object({
  itemId: pickId("an item"),
  projectId: pickId("a project"),
  stage: z.enum(valuesOf(PROJECT_STAGES), { error: "Pick the stage this stock is used in" }),
  quantity: stockQuantity,
  date: dateInput,
  note: optionalText(1000),
});
export type AssignFormInput = z.input<typeof assignFormSchema>;
export type AssignFormValues = z.output<typeof assignFormSchema>;

export const returnFormSchema = z.object({
  projectId: pickId("a project"),
  itemId: pickId("an item"),
  quantity: stockQuantity,
  date: dateInput,
  note: optionalText(1000),
});
export type ReturnFormInput = z.input<typeof returnFormSchema>;
export type ReturnFormValues = z.output<typeof returnFormSchema>;

export const projectIdSchema = z.object({ projectId: objectId });
