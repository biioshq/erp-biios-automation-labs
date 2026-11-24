import { BUDGET_HEADS, EXPENSE_CATEGORIES, labelOf, type BudgetHead } from "@/lib/constants";

/**
 * Which expense categories count under each budget head. Expenses are booked by category, never by
 * head, so this one mapping is how a budget head's spend is measured. Custom categories (added by
 * admins) and anything unlisted count as "Other expenses".
 */
export const HEAD_CATEGORIES: Record<BudgetHead, string[]> = {
  materials: ["materials", "inventory"],
  equipment: ["equipment"],
  labour: ["salaries", "labour", "contractors"],
  transport: ["travel", "logistics"],
  operations: ["rent", "utilities", "software", "maintenance"],
  administration: ["office", "professional_fees", "marketing", "interest"],
  other: ["other"],
};

const BY_CATEGORY = new Map(Object.entries(HEAD_CATEGORIES).flatMap(([head, cats]) => cats.map((c) => [c, head as BudgetHead])));

export function headOfCategory(category: string): BudgetHead {
  return BY_CATEGORY.get(category) ?? "other";
}

/** "Materials, Inventory" for a head, plus a note that custom categories count as other. */
export function headCategoryLabels(head: BudgetHead): string {
  const names = HEAD_CATEGORIES[head].map((c) => labelOf(EXPENSE_CATEGORIES, c as (typeof EXPENSE_CATEGORIES)[number]["value"]));
  return head === "other" ? `${names.join(", ")} and custom categories` : names.join(", ");
}

export const HEAD_LABEL = (head: BudgetHead) => labelOf(BUDGET_HEADS, head);
