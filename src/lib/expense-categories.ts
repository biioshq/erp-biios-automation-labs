import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/lib/constants";

/**
 * Expense categories: the built-in list in constants plus the ones admins add, with admins'
 * renames and hidden flags on top. Client-safe: the server reads the stored settings once per
 * request (src/server/expense-categories.ts) and passes the merged list to client components.
 *
 * A category's value is what expenses store. It never changes: renaming changes the label only,
 * so old records keep pointing at the same category.
 */
export type ExpenseCategoryOption = {
  value: string;
  label: string;
  /** Not offered for new records. Records that already use it keep it, show it and can be filtered by it. */
  hidden: boolean;
  /** One of EXPENSE_CATEGORIES. Built-ins can be renamed or hidden but not deleted. */
  builtIn: boolean;
};

/** What the expenseCategories collection holds: a custom category, or a rename or hide of a built-in. */
export type ExpenseCategorySetting = {
  value: string;
  label?: string | null;
  hidden?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

/** Custom values start with this, so they never clash with a built-in (now or added later) or a chart key. */
export const CUSTOM_CATEGORY_PREFIX = "c_";

/**
 * "inventory" is written by stock assignments and "salaries" drives who may see pay, so both always
 * exist and stay visible. "other" is the fallback everyone can pick.
 */
export const canHideExpenseCategory = (value: string) => value !== "inventory" && value !== "salaries";

/** Only categories admins added can be deleted, and only while nothing uses them. Built-ins can be hidden instead. */
export const canDeleteExpenseCategory = (category: Pick<ExpenseCategoryOption, "builtIn">) => !category.builtIn;

const BUILT_IN = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));
export const isBuiltInExpenseCategory = (value: string) => BUILT_IN.has(value);

const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() || 0 : 0);

/**
 * Built-ins in their usual order with any overrides applied, then custom categories in the order
 * they were added, with "Other" kept last. With no stored settings this is exactly EXPENSE_CATEGORIES.
 */
export function mergeExpenseCategories(settings: readonly ExpenseCategorySetting[]): ExpenseCategoryOption[] {
  // Two settings for one value can only appear without the unique index; the newest one wins.
  const byValue = new Map<string, ExpenseCategorySetting>();
  for (const s of [...settings].sort((a, b) => time(a.updatedAt) - time(b.updatedAt))) {
    if (s?.value) byValue.set(s.value, s);
  }
  const builtIns: ExpenseCategoryOption[] = EXPENSE_CATEGORIES.map((c) => {
    const s = byValue.get(c.value);
    return {
      value: c.value,
      label: s?.label?.trim() || c.label,
      hidden: canHideExpenseCategory(c.value) ? Boolean(s?.hidden) : false,
      builtIn: true,
    };
  });
  const custom: ExpenseCategoryOption[] = [...byValue.values()]
    .filter((s) => !BUILT_IN.has(s.value))
    .sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.value.localeCompare(b.value))
    .map((s) => ({ value: s.value, label: s.label?.trim() || s.value, hidden: Boolean(s.hidden), builtIn: false }));
  const otherAt = builtIns.findIndex((c) => c.value === "other");
  return [...builtIns.slice(0, otherAt), ...custom, ...builtIns.slice(otherAt)];
}

/** The built-in list as options, for a client component whose page did not pass the merged list. */
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategoryOption[] = mergeExpenseCategories([]);

/** The label to show for a stored value. Unknown values show as stored, so no record ever shows blank. */
export function expenseCategoryLabel(categories: readonly ExpenseCategoryOption[], value: string | null | undefined): string {
  if (!value) return "";
  return categories.find((c) => c.value === value)?.label ?? BUILT_IN.get(value) ?? value;
}

/**
 * Choices for a form: visible categories, never "inventory" (stock assignments write it), and
 * salaries only when allowed. The record's current category is always kept, even if hidden since,
 * so editing an old record never empties the field.
 */
export function expenseCategoryChoices(
  categories: readonly ExpenseCategoryOption[],
  { current, allowSalaries = true }: { current?: string | null; allowSalaries?: boolean } = {},
): { value: string; label: string }[] {
  const out = categories
    .filter((c) => c.value === current || (!c.hidden && c.value !== "inventory" && (allowSalaries || c.value !== "salaries")))
    .map((c) => ({ value: c.value, label: c.hidden ? `${c.label} (hidden)` : c.label }));
  if (current && !out.some((c) => c.value === current)) out.push({ value: current, label: expenseCategoryLabel(categories, current) });
  return out;
}

/** Choices for list filters: every category, hidden ones included, so older records can still be found. */
export function expenseCategoryFilterOptions(
  categories: readonly ExpenseCategoryOption[],
  { includeInventory = true }: { includeInventory?: boolean } = {},
): { value: string; label: string }[] {
  return categories
    .filter((c) => includeInventory || c.value !== "inventory")
    .map((c) => ({ value: c.value, label: c.hidden ? `${c.label} (hidden)` : c.label }));
}

/** A new category's name, and a rename. */
export const expenseCategoryLabelSchema = z
  .string({ error: "Name is required" })
  .trim()
  .min(1, "Name is required")
  .max(60, "At most 60 characters");

/**
 * A category value in a form. Whether it is a known, visible category is checked on the server
 * (assertExpenseCategoryAllowed), since custom categories live in the database.
 */
export const expenseCategoryValueSchema = z
  .string({ error: "Pick a category" })
  .trim()
  .min(1, "Pick a category")
  .max(80, "Pick a category");
