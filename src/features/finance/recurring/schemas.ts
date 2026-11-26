import { z } from "zod";
import { PAYMENT_METHODS, PROJECT_STAGES, RECURRING_FREQUENCIES, valuesOf, type ExpenseCategory, type RecurringFrequency } from "@/lib/constants";
import { expenseCategoryValueSchema } from "@/lib/expense-categories";
import { GST_RATES } from "@/config/company";
import { dateInput, gstin, objectId, optionalDateInput, optionalObjectId, optionalText, positiveMoney, requiredText } from "@/lib/zod";

/** Validation shared by the schedule form (client) and the recurring actions (server). Client-safe. */

export const recurringFormSchema = z
  .object({
    name: requiredText("Name", 160),
    vendor: requiredText("Vendor", 200),
    /** Built-in or custom; the actions check it is a known, visible category (or the schedule's current one). */
    category: expenseCategoryValueSchema,
    description: optionalText(1000),
    amount: positiveMoney,
    gstRate: z
      .number()
      .refine((r) => (GST_RATES as readonly number[]).includes(r), "Pick a GST rate"),
    gstin,
    hsnSac: optionalText(120),
    paymentMethod: z.enum(valuesOf(PAYMENT_METHODS), { error: "Pick a payment method" }),
    projectId: optionalObjectId,
    stage: z.enum(valuesOf(PROJECT_STAGES)).optional(),
    employeeId: optionalObjectId,
    frequency: z.enum(valuesOf(RECURRING_FREQUENCIES), { error: "Pick how often" }),
    /** 1 to 28, or 31 for the last day of the month. Ignored for weekly schedules. */
    dayOfMonth: z.number().int().min(1).max(31),
    startDate: dateInput,
    endDate: optionalDateInput,
    notes: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.projectId && !v.stage) {
      ctx.addIssue({ code: "custom", path: ["stage"], message: "Every project expense belongs to a stage" });
    }
    if (v.paymentMethod === "stock") {
      ctx.addIssue({ code: "custom", path: ["paymentMethod"], message: "Stock expenses are created by assigning inventory" });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date must be on or after the start date" });
    }
  });

export type RecurringFormInput = z.input<typeof recurringFormSchema>;
export type RecurringFormValues = z.output<typeof recurringFormSchema>;

export const recurringIdSchema = z.object({ id: objectId });

export const recurringStatusSchema = z.object({
  id: objectId,
  action: z.enum(["pause", "resume", "end"]),
});

/** Filter keys accepted in the URL of the recurring list. `group` is the tab (one value). */
export const RECURRING_FILTER_KEYS = ["group", "category", "status", "frequency", "project"] as const;
export const RECURRING_SORT_KEYS = ["nextRunDate", "amount", "name", "createdAt"] as const;

/** Category-based tabs. "paused" and "ended" are status-based. */
export const RECURRING_GROUPS = [
  { value: "all", label: "All" },
  { value: "salaries", label: "Salaries" },
  { value: "bills", label: "Bills & rent" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
] as const;
export type RecurringGroup = (typeof RECURRING_GROUPS)[number]["value"];

export const GROUP_CATEGORIES: Record<"salaries" | "bills" | "subscriptions", ExpenseCategory[]> = {
  salaries: ["salaries"],
  bills: ["rent", "utilities"],
  subscriptions: ["software", "professional_fees"],
};

export type RecurringTemplate = {
  key: string;
  label: string;
  name: string;
  category: ExpenseCategory;
  frequency: RecurringFrequency;
  dayOfMonth: number;
  gstRate: number;
  description: string;
};

/** Quick starts for the new schedule form and the empty state. */
export const RECURRING_TEMPLATES: RecurringTemplate[] = [
  { key: "salary", label: "Salary", name: "Monthly salary", category: "salaries", frequency: "monthly", dayOfMonth: 1, gstRate: 0, description: "Salary for the month" },
  { key: "rent", label: "Office rent", name: "Office rent", category: "rent", frequency: "monthly", dayOfMonth: 5, gstRate: 0, description: "Monthly office rent" },
  { key: "electricity", label: "Electricity bill", name: "Electricity bill", category: "utilities", frequency: "monthly", dayOfMonth: 10, gstRate: 0, description: "Monthly electricity bill" },
  { key: "internet", label: "Internet", name: "Internet connection", category: "utilities", frequency: "monthly", dayOfMonth: 5, gstRate: 18, description: "Monthly broadband plan" },
  { key: "software", label: "Software subscription", name: "Software subscription", category: "software", frequency: "monthly", dayOfMonth: 1, gstRate: 18, description: "Monthly software subscription" },
];
