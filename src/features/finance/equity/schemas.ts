import { z } from "zod";
import { CAPITAL_ENTRY_TYPES, EQUITY_HOLDER_KINDS, INVESTOR_INSTRUMENTS, valuesOf } from "@/lib/constants";
import { MAX_MONEY, dateInput, objectId, optionalObjectId, optionalText, requiredText } from "@/lib/zod";
import { EQUITY_PAYMENT_VALUES, isMoneyEntry } from "./labels";

/** Validation shared by the equity forms (client) and the equity actions (server). Client-safe. */

const optionalEnum = <T extends string>(values: [T, ...T[]]) =>
  z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((v) => (v ? (v as T) : undefined));

/* Owners and investors */

export const holderFormSchema = z.object({
  name: requiredText("Name", 160),
  kind: z.enum(valuesOf(EQUITY_HOLDER_KINDS), { error: "Pick owner or investor" }),
  ownershipPercent: z.number().finite().min(0, "Cannot be negative").max(100, "At most 100%").optional(),
  instrument: optionalEnum(valuesOf(INVESTOR_INSTRUMENTS)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.email({ error: "Enter a valid email address" }).optional()),
  phone: optionalText(30),
  notes: optionalText(2000),
});
export type HolderFormInput = z.input<typeof holderFormSchema>;
export type HolderFormValues = z.output<typeof holderFormSchema>;

export const holderIdSchema = z.object({ id: objectId });

/* Capital entries */

/**
 * One form for every entry type; the fields that apply depend on `type`. The server checks the
 * same rules again in createCapitalEntry (server.ts), which bank statement imports also use.
 */
export const entryFormSchema = z
  .object({
    type: z.enum(valuesOf(CAPITAL_ENTRY_TYPES)),
    holderId: optionalObjectId,
    /** A new owner or investor typed into the capital form, created with the entry. */
    newHolderName: optionalText(160),
    newHolderKind: optionalEnum(valuesOf(EQUITY_HOLDER_KINDS)),
    date: dateInput,
    amount: z.number({ error: "Enter an amount" }).finite().min(-MAX_MONEY, "That amount is too large").max(MAX_MONEY, "That amount is too large"),
    paymentMethod: optionalEnum(EQUITY_PAYMENT_VALUES),
    accountId: optionalObjectId,
    reference: optionalText(120),
    purpose: optionalText(500),
    notes: optionalText(4000),
    /** Capital only: "initial" (the first money in), "additional", or "auto" (decided by the holder's earlier entries). */
    contribution: z.enum(["auto", "initial", "additional"]).optional(),
    instrument: optionalEnum(valuesOf(INVESTOR_INSTRUMENTS)),
    reserveGroup: optionalText(80),
    documentIds: z.array(objectId).max(20, "At most 20 documents").default([]),
  })
  .superRefine((v, ctx) => {
    if (v.type === "opening_retained") {
      if (v.amount === 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount (negative for accumulated losses)" });
    } else if (!(v.amount > 0)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Must be more than zero" });
    }
    if ((v.type === "capital" || v.type === "drawing") && !v.holderId && !v.newHolderName) {
      // On both fields: the form shows one or the other, depending on whether a new person is typed in.
      ctx.addIssue({ code: "custom", path: ["holderId"], message: v.type === "drawing" ? "Pick the owner" : "Pick who put the money in" });
      ctx.addIssue({ code: "custom", path: ["newHolderName"], message: "Enter their name" });
    }
    if (isMoneyEntry(v.type) && !v.paymentMethod) ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Pick how the money moved" });
    if (v.type === "reserve_transfer" && !v.reserveGroup) ctx.addIssue({ code: "custom", path: ["reserveGroup"], message: "Pick the reserve" });
  });
export type EntryFormInput = z.input<typeof entryFormSchema>;
export type EntryFormValues = z.output<typeof entryFormSchema>;

export const entryIdSchema = z.object({ id: objectId });
