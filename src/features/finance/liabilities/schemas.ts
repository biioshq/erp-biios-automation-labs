import { z } from "zod";
import { LIABILITY_KINDS, LIABILITY_SOURCES, PAYMENT_METHODS, valuesOf, type PaymentMethod } from "@/lib/constants";
import { dateInput, money, objectId, optionalDateInput, optionalObjectId, optionalText, positiveMoney, requiredText } from "@/lib/zod";

/** Validation shared by the liability forms (client) and the liability actions (server). Client-safe. */

/** How a liability is received or repaid. "On credit" and "From stock" move no money, so they do not apply. */
export const REPAYMENT_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "credit" && m.value !== "stock");
const repaymentMethodValues = REPAYMENT_METHODS.map((m) => m.value) as [PaymentMethod, ...PaymentMethod[]];

const optionalNumber = (max: number, message: string) =>
  z.number().finite().min(0, "Cannot be negative").max(max, message).optional();

export const liabilityFormSchema = z
  .object({
    name: requiredText("Name", 160),
    kind: z.enum(valuesOf(LIABILITY_KINDS), { error: "Pick what it is" }),
    group: z.string({ error: "Pick a group" }).trim().min(1, "Pick a group").max(80),
    lender: requiredText("Lender", 200),
    originalAmount: positiveMoney,
    date: dateInput,
    dueDate: optionalDateInput,
    interestRate: optionalNumber(100, "At most 100%"),
    tenureMonths: z.number().int("Whole months only").min(1, "At least 1 month").max(600, "At most 600 months").optional(),
    installment: positiveMoney.optional(),
    sourceMode: z.enum(valuesOf(LIABILITY_SOURCES), { error: "Pick where the money went" }),
    accountId: optionalObjectId,
    paymentMethod: z.enum(repaymentMethodValues).optional(),
    /** Source "accrued" only: the expense category the cost belongs to. */
    category: z.string().trim().max(80).optional(),
    reference: optionalText(120),
    notes: optionalText(4000),
    documentIds: z.array(objectId).max(20, "At most 20 documents at a time").default([]),
  })
  .superRefine((v, ctx) => {
    if (v.dueDate && v.dueDate < v.date) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Cannot be before the date it was taken" });
    if (v.sourceMode === "accrued" && v.kind === "loan") ctx.addIssue({ code: "custom", path: ["sourceMode"], message: "Not for loans" });
    if (v.sourceMode === "accrued" && !v.category) ctx.addIssue({ code: "custom", path: ["category"], message: "Pick a category" });
  });

export type LiabilityFormInput = z.input<typeof liabilityFormSchema>;
export type LiabilityFormValues = z.output<typeof liabilityFormSchema>;

export const liabilityIdSchema = z.object({ id: objectId });

export const repaymentFormSchema = z
  .object({
    liabilityId: objectId,
    date: dateInput,
    principal: money.default(0),
    interest: money.default(0),
    paymentMethod: z.enum(repaymentMethodValues, { error: "Pick how it was paid" }),
    accountId: optionalObjectId,
    reference: optionalText(120),
    note: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.principal + v.interest <= 0) ctx.addIssue({ code: "custom", path: ["principal"], message: "Enter the principal, the interest or both" });
  });

export type RepaymentFormInput = z.input<typeof repaymentFormSchema>;
export type RepaymentFormValues = z.output<typeof repaymentFormSchema>;

export const repaymentRefSchema = z.object({ liabilityId: objectId, paymentId: objectId });

export const liabilityDocumentsSchema = z.object({ liabilityId: objectId, fileIds: z.array(objectId).min(1).max(20) });
export const liabilityDocumentSchema = z.object({ liabilityId: objectId, fileId: objectId });

/* URL filters */

export const LOAN_FILTER_KEYS = ["lender", "status", "group", "due"] as const;
export const LOAN_SORT_KEYS = ["name", "date", "dueDate", "originalAmount", "outstanding", "interestRate"] as const;
export const PAYABLE_FILTER_KEYS = ["vendor", "status", "due"] as const;
export const PAYABLE_SORT_KEYS = ["vendor", "date", "dueDate", "amount", "outstanding"] as const;
export const GROUP_FILTER_KEYS = ["lender", "status", "due"] as const;

/** Due-date buckets offered as a filter. */
export const DUE_BUCKETS = [
  { value: "overdue", label: "Overdue" },
  { value: "7d", label: "Due in 7 days" },
  { value: "30d", label: "Due in 30 days" },
  { value: "later", label: "Due later" },
  { value: "none", label: "No due date" },
] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number]["value"];
