import { z } from "zod";
import { INVESTMENT_TYPES, valuesOf } from "@/lib/constants";
import { dateInput, money, objectId, optionalDateInput, optionalMoney, optionalObjectId, optionalText, positiveMoney, requiredText } from "@/lib/zod";

/** Validation shared by the investment forms (client) and actions (server). Client-safe. */

export const investmentFormSchema = z
  .object({
    name: requiredText("Name", 160),
    type: z.enum(valuesOf(INVESTMENT_TYPES)),
    group: z.string({ error: "Pick a group" }).trim().min(1, "Pick a group").max(80),
    institution: optionalText(160),
    reference: optionalText(120),
    purchaseDate: dateInput,
    amount: positiveMoney,
    /** "account": paid from one of the company's accounts; "opening": held before the books started. */
    source: z.enum(["account", "opening"]),
    accountId: optionalObjectId,
    currentValue: optionalMoney,
    valuedOn: optionalDateInput,
    interestRate: z.number().finite().min(0, "Cannot be negative").max(100, "At most 100").optional(),
    maturityDate: optionalDateInput,
    notes: optionalText(2000),
    documentIds: z.array(objectId).max(20).optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.source === "account" && !v.accountId) issue("accountId", "Pick the account it was paid from");
    if (v.currentValue !== undefined && !v.valuedOn) issue("valuedOn", "Enter the date of this value");
    if (v.valuedOn && v.currentValue === undefined) issue("currentValue", "Enter the value on that date");
    if (v.valuedOn && v.valuedOn < v.purchaseDate) issue("valuedOn", "Cannot be before the purchase date");
    if (v.maturityDate && v.maturityDate < v.purchaseDate) issue("maturityDate", "Cannot be before the purchase date");
  });

export type InvestmentFormInput = z.input<typeof investmentFormSchema>;
export type InvestmentFormValues = z.output<typeof investmentFormSchema>;

export const investmentIdSchema = z.object({ id: objectId });

export const redemptionFormSchema = z.object({
  id: objectId,
  date: dateInput,
  /** What came back, in total. */
  amount: money,
  accountId: optionalObjectId,
  notes: optionalText(1000),
});
export type RedemptionFormInput = z.input<typeof redemptionFormSchema>;
export type RedemptionFormValues = z.output<typeof redemptionFormSchema>;

export const investmentDocumentsSchema = z.object({ id: objectId, fileIds: z.array(objectId).min(1).max(20) });
export const investmentDocumentSchema = z.object({ id: objectId, fileId: objectId });

export const INVESTMENT_FILTER_KEYS = ["group", "type", "status"] as const;
export const INVESTMENT_STATUSES = [
  { value: "held", label: "Held" },
  { value: "redeemed", label: "Redeemed" },
  { value: "archived", label: "Archived" },
] as const;
