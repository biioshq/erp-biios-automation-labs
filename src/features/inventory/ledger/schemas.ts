import { z } from "zod";
import { PROJECT_STAGES, valuesOf } from "@/lib/constants";
import { dateInput, gstin, money, objectId, optionalDateInput, optionalMoney, optionalObjectId, optionalText, quantity } from "@/lib/zod";
import { gstGrandTotal } from "@/lib/gst";

/** Validation shared by the stock operation forms (client) and their actions (server). Client-safe. */

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
    quantity,
    unitPrice: money,
    vendor: optionalText(200),
    date: dateInput,
    invoice: invoiceSchema,
    receiptFileId: optionalObjectId,
    note: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    const g = v.invoice;
    if ((g.igst ?? 0) > 0 && ((g.cgst ?? 0) > 0 || (g.sgst ?? 0) > 0)) {
      ctx.addIssue({ code: "custom", path: ["invoice", "igst"], message: "Use IGST or CGST + SGST, not both" });
    }
    const taxes = (g.cgst ?? 0) + (g.sgst ?? 0) + (g.igst ?? 0) + (g.cess ?? 0);
    if (taxes > 0 && !((g.taxableAmount ?? 0) > 0)) {
      ctx.addIssue({ code: "custom", path: ["invoice", "taxableAmount"], message: "Enter the taxable amount the tax applies to" });
    }
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
  quantity,
  date: dateInput,
  note: optionalText(1000),
});
export type AssignFormInput = z.input<typeof assignFormSchema>;
export type AssignFormValues = z.output<typeof assignFormSchema>;

export const returnFormSchema = z.object({
  projectId: pickId("a project"),
  itemId: pickId("an item"),
  quantity,
  date: dateInput,
  note: optionalText(1000),
});
export type ReturnFormInput = z.input<typeof returnFormSchema>;
export type ReturnFormValues = z.output<typeof returnFormSchema>;

export const projectIdSchema = z.object({ projectId: objectId });
