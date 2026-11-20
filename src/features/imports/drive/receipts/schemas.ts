import { z } from "zod";
import { PAYMENT_METHODS, PROJECT_STAGES, valuesOf } from "@/lib/constants";
import { MAX_MONEY, objectId, optionalDateInput, optionalObjectId } from "@/lib/zod";

/**
 * Validation for Drive receipt drafts. Client-safe.
 *
 * A draft may be incomplete (that is why it is a draft), so its values are checked loosely when
 * they are kept, and with the expense form's own schema (expenseFormSchema, through createExpense)
 * when they are saved as an expense.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => v ?? "");
const amount = z
  .number()
  .finite()
  .min(0, "Cannot be negative")
  .max(MAX_MONEY, "That amount is too large")
  .nullish()
  .transform((v) => (v === null ? undefined : v));

export const draftValuesSchema = z.object({
  vendor: text(200),
  vendorAddress: text(500),
  projectId: optionalObjectId,
  stage: z.enum(valuesOf(PROJECT_STAGES)).nullish().transform((v) => v ?? undefined),
  category: text(80),
  description: text(1000),
  amount,
  date: optionalDateInput,
  paymentMethod: z
    .enum(valuesOf(PAYMENT_METHODS))
    .nullish()
    .transform((v) => (v && v !== "stock" ? v : "bank_transfer")),
  notes: text(4000),
  gst: z
    .object({
      gstin: text(20),
      invoiceNumber: text(60),
      invoiceDate: optionalDateInput,
      taxableAmount: amount,
      cgst: amount,
      sgst: amount,
      igst: amount,
      cess: amount,
      hsnSac: text(120),
      grandTotal: amount,
    })
    .partial()
    .default({}),
});

export type DraftValuesInput = z.input<typeof draftValuesSchema>;
export type DraftValues = z.output<typeof draftValuesSchema>;

export const listDriveReceiptsSchema = z.object({
  link: z.string().trim().min(1, "Paste a Google Drive folder or file link").max(2000),
});

export const draftIdSchema = z.object({ id: objectId });

export const updateDraftSchema = z.object({ id: objectId, values: draftValuesSchema });

/**
 * Saving one draft from the review form. The values are kept on the draft first, then checked with
 * the expense form's schema by the create logic (the form checks them in the browser before that).
 */
export const saveDraftSchema = z.object({ id: objectId, values: draftValuesSchema.optional() });

export const saveDraftsSchema = z.object({
  ids: z.array(objectId).min(1, "Tick at least one draft").max(50, "Save at most 50 drafts at a time"),
});

export const setDraftsCategorySchema = z.object({
  ids: z.array(objectId).min(1, "Tick at least one draft").max(500),
  category: z.string().trim().min(1, "Pick a category").max(80),
});
