import { z } from "zod";
import { GSTIN_REGEX } from "./gst";

/** Shared Zod building blocks so every form validates the same way. Client-safe. */

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const optionalObjectId = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(objectId.optional());

/** "yyyy-mm-dd" */
export const dateInput = z.string({ error: "Pick a date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
export const optionalDateInput = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(dateInput.optional());

export const money = z.number({ error: "Enter an amount" }).finite().min(0, "Cannot be negative");
export const positiveMoney = z.number({ error: "Enter an amount" }).finite().positive("Must be more than zero");
export const optionalMoney = money.optional();
export const quantity = z.number({ error: "Enter a quantity" }).finite().positive("Must be more than zero");

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));
export const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `At most ${max} characters`);

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.string().regex(GSTIN_REGEX, "Not a valid GSTIN (e.g. 27AAPFU0939F1ZV)").optional());
