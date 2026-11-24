import { z } from "zod";
import { BANK_ACCOUNT_KINDS, PAYMENT_METHODS, labelOf, valuesOf, type PaymentMethod } from "@/lib/constants";
import { MAX_MONEY, dateInput, objectId, optionalText, positiveMoney, requiredText } from "@/lib/zod";

/** Validation shared by the cash and bank forms (client) and their actions (server). Client-safe. */

/**
 * Methods an account can be the default for. "On credit" moves no money until it is paid (each
 * payment names its own method), and "From stock" and the group company never touch an account.
 */
export const DEFAULT_FOR_METHODS = ["cash", "bank_transfer", "upi", "card", "cheque", "other"] as const satisfies readonly PaymentMethod[];
export type DefaultForMethod = (typeof DEFAULT_FOR_METHODS)[number];
export const DEFAULT_FOR_OPTIONS = DEFAULT_FOR_METHODS.map((value) => ({ value, label: labelOf(PAYMENT_METHODS, value) }));

const optionalLast4 = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().regex(/^\d{4}$/, "Enter the last 4 digits only").optional());

const optionalIfsc = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Not a valid IFSC (e.g. HDFC0001234)").optional());

/** Opening balances may be negative (an overdraft on the opening date). */
const signedMoney = z
  .number({ error: "Enter an amount" })
  .finite()
  .min(-MAX_MONEY, "That amount is too large")
  .max(MAX_MONEY, "That amount is too large");

export const bankAccountFormSchema = z.object({
  name: requiredText("Name", 120),
  kind: z.enum(valuesOf(BANK_ACCOUNT_KINDS), { error: "Pick bank account or cash" }),
  bankName: optionalText(120),
  accountLast4: optionalLast4,
  ifsc: optionalIfsc,
  openingBalance: signedMoney,
  openingDate: dateInput,
  defaultFor: z.array(z.enum(DEFAULT_FOR_METHODS)).max(DEFAULT_FOR_METHODS.length).default([]),
  notes: optionalText(2000),
});

export type BankAccountFormInput = z.input<typeof bankAccountFormSchema>;
export type BankAccountFormValues = z.output<typeof bankAccountFormSchema>;

export const idSchema = z.object({ id: objectId });

export const transferFormSchema = z
  .object({
    fromAccountId: objectId,
    toAccountId: objectId,
    amount: positiveMoney,
    date: dateInput,
    reference: optionalText(120),
    notes: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.fromAccountId === v.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Pick a different account to move the money into" });
    }
  });

export type TransferFormInput = z.input<typeof transferFormSchema>;
export type TransferFormValues = z.output<typeof transferFormSchema>;
