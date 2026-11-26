import { z } from "zod";
import { gstin } from "@/lib/zod";

/** Validation for the business details form (client) and its action (server). Client-safe. */

/** Empty text becomes undefined; otherwise the value must fit the pattern (after trimming). */
const pattern = (regex: RegExp, message: string, max: number, upper = false) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .transform((v) => (v ? (upper ? v.toUpperCase() : v) : undefined))
    .refine((v) => v === undefined || regex.test(v), message);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const companyProfileSchema = z.object({
  legalName: text(200),
  tradeName: text(200),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(100),
  state: text(100),
  stateCode: pattern(/^\d{2}$/, "Two digits, such as 27", 2),
  pin: pattern(/^\d{6}$/, "Six digits", 10),
  gstin,
  pan: pattern(PAN_REGEX, "Not a valid PAN (e.g. ABCDE1234F)", 10, true),
  cin: text(21),
  phone: text(40),
  email: pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Not a valid email address", 200),
  website: text(200),
  bankName: text(120),
  accountName: text(200),
  accountNumber: pattern(/^[A-Za-z0-9 -]+$/, "Letters and digits only", 40),
  ifsc: pattern(IFSC_REGEX, "Not a valid IFSC (e.g. HDFC0001234)", 11, true),
  branch: text(120),
  upiId: pattern(/^[\w.-]+@[\w.-]+$/, "Not a valid UPI ID (e.g. name@bank)", 120),
  invoiceTerms: text(2000),
  footerNote: text(500),
  signatoryName: text(120),
  signatoryTitle: text(120),
});

export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export type CompanyProfileValues = z.output<typeof companyProfileSchema>;

/** The saved details, every field a string (empty when not set). */
export type CompanyDetails = { [K in keyof CompanyProfileValues]-?: string };

export const COMPANY_FIELDS = Object.keys(companyProfileSchema.shape) as (keyof CompanyProfileValues)[];

export const EMPTY_COMPANY_DETAILS = Object.fromEntries(COMPANY_FIELDS.map((k) => [k, ""])) as CompanyDetails;
