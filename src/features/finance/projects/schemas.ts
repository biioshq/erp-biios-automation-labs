import { z } from "zod";
import { PROJECT_DOCUMENT_TYPES, PROJECT_STATUSES, valuesOf } from "@/lib/constants";
import { money, objectId, optionalDateInput, optionalMoney, optionalText, requiredText } from "@/lib/zod";

/** Validation shared by the project form (client) and the project actions (server). Client-safe. */

/** Accent colours offered in the project form (stored on the project, used by cards and charts). */
export const PROJECT_COLORS = [
  { value: "#4a82cc", label: "Blue" },
  { value: "#ff8800", label: "Orange" },
  { value: "#12958a", label: "Teal" },
  { value: "#7c5cd6", label: "Violet" },
  { value: "#d4517a", label: "Rose" },
  { value: "#3ba776", label: "Green" },
  { value: "#d99206", label: "Amber" },
  { value: "#6b7a99", label: "Slate" },
] as const;

export const PROJECT_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name (A to Z)" },
  { value: "budget", label: "Budget (high to low)" },
  { value: "spent", label: "Spent (high to low)" },
  { value: "end", label: "End date (soonest)" },
] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number]["value"];

export const PROJECT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "budget", label: "Budget" },
  { value: "expenses", label: "Expenses" },
  { value: "inventory", label: "Inventory used" },
  { value: "team", label: "Team" },
  { value: "timeline", label: "Timeline" },
  { value: "documents", label: "Documents" },
] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number]["value"];

export const projectFormSchema = z
  .object({
    name: requiredText("Project name", 160),
    client: optionalText(160),
    description: optionalText(4000),
    status: z.enum(valuesOf(PROJECT_STATUSES), { error: "Pick a status" }),
    budget: money,
    /** What the client pays for the whole project, when agreed. Empty = not recorded. */
    contractValue: optionalMoney,
    /** Why the budget changed; kept with the old budget in the budget history. Edit only. */
    budgetNote: optionalText(500),
    /**
     * The budget the edit form was opened with. The update only applies while the stored budget
     * is still this figure, so a form opened before someone else changed the budget cannot revert it.
     */
    expectedBudget: z.number().finite().optional(),
    startDate: optionalDateInput,
    endDate: optionalDateInput,
    color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour"),
    stageBudgets: z
      .object({
        research: optionalMoney,
        design: optionalMoney,
        prototype: optionalMoney,
        development: optionalMoney,
        testing: optionalMoney,
        production: optionalMoney,
        deployment: optionalMoney,
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date cannot be before the start date" });
    }
  });

export type ProjectFormInput = z.input<typeof projectFormSchema>;
export type ProjectFormValues = z.output<typeof projectFormSchema>;

export const projectIdSchema = z.object({ id: objectId });

/** The Edit budget dialog: a new allocated budget, guarded by the budget it was opened with. */
export const projectBudgetSchema = z.object({
  id: objectId,
  budget: money,
  /** The budget the dialog was opened with; the change only applies while it is still stored. */
  expectedBudget: z.number().finite(),
  /** Why the budget changed; kept with the old budget in the budget history. */
  note: optionalText(500),
});
export type ProjectBudgetInput = z.input<typeof projectBudgetSchema>;
export type ProjectBudgetValues = z.output<typeof projectBudgetSchema>;
export const projectStatusSchema = z.object({ id: objectId, status: z.enum(valuesOf(PROJECT_STATUSES)) });

export const documentRefSchema = z.object({ projectId: objectId, fileId: objectId });
export const documentTypeSchema = documentRefSchema.extend({ documentType: z.enum(valuesOf(PROJECT_DOCUMENT_TYPES)) });
