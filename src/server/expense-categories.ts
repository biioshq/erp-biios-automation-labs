import "server-only";

import { randomBytes } from "node:crypto";
import { cache } from "react";
import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { AppError, isDuplicateKeyError } from "@/server/errors";
import { Expense, ExpenseCategorySetting, RecurringExpense } from "@/server/models";
import {
  CUSTOM_CATEGORY_PREFIX,
  canDeleteExpenseCategory,
  canHideExpenseCategory,
  expenseCategoryLabel,
  isBuiltInExpenseCategory,
  mergeExpenseCategories,
  type ExpenseCategoryOption,
} from "@/lib/expense-categories";

/**
 * Server side of custom expense categories: the merged list (read once per request), the check
 * every expense and schedule write makes, and the admin changes (add, rename, hide, delete).
 * The rules live here as plain functions; the server actions only wrap them.
 */

/** The merged list, read fresh. Use inside writes, so a change is seen straight away. */
export async function loadExpenseCategories(): Promise<ExpenseCategoryOption[]> {
  await connectDB();
  const settings = await ExpenseCategorySetting.find({}, { value: 1, label: 1, hidden: 1, createdAt: 1, updatedAt: 1 }).lean();
  return mergeExpenseCategories(settings);
}

/** The merged list, read once per request (pages, queries and report builders share it). */
export const getExpenseCategories = cache(loadExpenseCategories);

/** value → label for the current request, for server code that labels many rows. */
export async function getExpenseCategoryLabeler(): Promise<(value: string | null | undefined) => string> {
  const categories = await getExpenseCategories();
  return (value) => expenseCategoryLabel(categories, value);
}

const categoryError = (message: string, field = "category") => new AppError(message, "invalid", { [field]: [message] });

/**
 * A new or changed category must be a known, visible category, and never "inventory" (stock
 * assignments write that one). A record that keeps its current category always saves, even when
 * that category has been hidden since or is not in the list.
 */
export async function assertExpenseCategoryAllowed(value: string, current?: string | null): Promise<void> {
  if (current != null && value === current) return;
  if (value === "inventory") throw categoryError("Inventory expenses are created by stock purchases and assignments. Pick another category.");
  const category = (await loadExpenseCategories()).find((c) => c.value === value);
  if (!category) throw categoryError("Pick a category from the list.");
  if (category.hidden) throw categoryError(`${category.label} is hidden, so it takes no new records. Pick another category.`);
}

const labelKey = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

/** The dialog shows the field error, so it carries the whole sentence. */
const labelError = (message: string) => new AppError(message, "conflict", { label: [message] });

const labelTaken = (clash: ExpenseCategoryOption) =>
  labelError(clash.hidden ? `${clash.label} already exists but is hidden. Show it instead.` : `A category named ${clash.label} already exists.`);

/** No two categories share a name (ignoring case and spaces), built-ins and hidden ones included. */
function assertLabelFree(categories: ExpenseCategoryOption[], label: string, exceptValue?: string) {
  const key = labelKey(label);
  const clash = categories.find((c) => c.value !== exceptValue && labelKey(c.label) === key);
  if (clash) throw labelTaken(clash);
}

/**
 * The check above runs before writing, so two admins (or two tabs) adding or renaming to the same
 * name at once could both pass it. Nothing stored enforces names (the unique index covers values
 * only, and may not exist), so each write looks again afterwards and undoes itself on a clash.
 * When both writes land together both undo, which leaves no duplicate; the admin tries again.
 */
async function nameClashAfterWrite(value: string, label: string): Promise<ExpenseCategoryOption | undefined> {
  const key = labelKey(label);
  return (await loadExpenseCategories()).find((c) => c.value !== value && labelKey(c.label) === key);
}

const changedAtOnce = (label: string) =>
  labelError(`Someone else named a category ${label} at the same moment. Check the list and try again.`);

function findCategory(categories: ExpenseCategoryOption[], value: string): ExpenseCategoryOption {
  const category = categories.find((c) => c.value === value);
  if (!category) throw new AppError("That category was not found. It may have been deleted.", "not_found");
  return category;
}

/** "Site visits" → "c_site_visits_k3f9": readable, and unique even if a later label slugs the same way. */
export function newCategoryValue(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
    .replace(/_+$/g, "");
  const suffix = randomBytes(3).toString("hex").slice(0, 4);
  return `${CUSTOM_CATEGORY_PREFIX}${slug || "category"}_${suffix}`;
}

export async function createExpenseCategory(label: string, userId?: string): Promise<ExpenseCategoryOption> {
  const categories = await loadExpenseCategories();
  assertLabelFree(categories, label);
  for (let attempt = 0; attempt < 5; attempt++) {
    const value = newCategoryValue(label);
    // Checked in code as well: the unique index may not exist yet where setup has not run.
    if (categories.some((c) => c.value === value) || (await ExpenseCategorySetting.exists({ value }))) continue;
    try {
      const created = await ExpenseCategorySetting.create({
        value,
        label,
        hidden: false,
        builtIn: false,
        ...(userId && Types.ObjectId.isValid(userId) ? { createdBy: new Types.ObjectId(userId) } : {}),
      });
      if (await nameClashAfterWrite(value, label)) {
        // Nothing can use the new value yet: it has not been returned to anyone.
        await ExpenseCategorySetting.deleteOne({ _id: created._id });
        throw changedAtOnce(label);
      }
      return { value, label, hidden: false, builtIn: false };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  throw new AppError("Could not add the category. Please try again.", "conflict");
}

/**
 * Writes a setting for a category. Built-ins get their override document on first change; custom
 * categories already have one. Fields are set on every copy of the value, so a duplicate left
 * without the unique index cannot bring an old label back.
 */
async function writeSetting(category: ExpenseCategoryOption, set: { label?: string; hidden?: boolean }) {
  if (category.builtIn) {
    await ExpenseCategorySetting.updateMany({ value: category.value }, { $set: set });
    if (!(await ExpenseCategorySetting.exists({ value: category.value }))) {
      try {
        await ExpenseCategorySetting.create({ value: category.value, builtIn: true, hidden: false, ...set });
      } catch (error) {
        // Created by a parallel change in the meantime: apply this one on top.
        if (!isDuplicateKeyError(error)) throw error;
        await ExpenseCategorySetting.updateMany({ value: category.value }, { $set: set });
      }
    }
    return;
  }
  const res = await ExpenseCategorySetting.updateMany({ value: category.value }, { $set: set });
  if (!res.matchedCount) throw new AppError("That category was not found. It may have been deleted.", "not_found");
}

/** Changes the name only; the stored value stays, so every record shows the new name. */
export async function renameExpenseCategory(value: string, label: string): Promise<ExpenseCategoryOption> {
  const categories = await loadExpenseCategories();
  const category = findCategory(categories, value);
  assertLabelFree(categories, label, value);
  const before = await ExpenseCategorySetting.findOne({ value }, { label: 1 }).lean();
  await writeSetting(category, { label });
  if (await nameClashAfterWrite(value, label)) {
    // Put the stored name back as it was; a built-in without one falls back to its usual name.
    await ExpenseCategorySetting.updateMany({ value }, before?.label ? { $set: { label: before.label } } : { $unset: { label: 1 } });
    throw changedAtOnce(label);
  }
  return { ...category, label };
}

/** Hidden categories are not offered for new records; existing ones keep and show them. */
export async function setExpenseCategoryHidden(value: string, hidden: boolean): Promise<ExpenseCategoryOption> {
  const categories = await loadExpenseCategories();
  const category = findCategory(categories, value);
  if (hidden && !canHideExpenseCategory(value)) {
    throw new AppError(`${category.label} is used by the app itself, so it always stays available.`, "conflict");
  }
  if (category.hidden !== hidden) await writeSetting(category, { hidden });
  return { ...category, hidden };
}

export type ExpenseCategoryUsage = Record<string, { expenses: number; schedules: number }>;

/** How many expenses and schedules use each category, every record counted (salaries too). */
export async function getExpenseCategoryUsage(): Promise<ExpenseCategoryUsage> {
  await connectDB();
  const [expenses, schedules] = await Promise.all([
    Expense.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
    RecurringExpense.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$category", n: { $sum: 1 } } }]),
  ]);
  const usage: ExpenseCategoryUsage = {};
  for (const e of expenses) if (e._id) (usage[e._id] ??= { expenses: 0, schedules: 0 }).expenses = e.n;
  for (const s of schedules) if (s._id) (usage[s._id] ??= { expenses: 0, schedules: 0 }).schedules = s.n;
  return usage;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Only a custom category that no expense and no schedule uses. Otherwise hide it, and history stays as it is. */
export async function deleteExpenseCategory(value: string): Promise<{ value: string }> {
  const categories = await loadExpenseCategories();
  const category = findCategory(categories, value);
  if (!canDeleteExpenseCategory(category) || isBuiltInExpenseCategory(value)) {
    throw new AppError(`${category.label} is a built-in category, so it cannot be deleted. Hide it instead.`, "conflict");
  }
  // Hidden first, so no new record can take it between the count and the delete.
  if (!category.hidden) await writeSetting(category, { hidden: true });
  const [expenses, schedules] = await Promise.all([
    Expense.countDocuments({ category: value }),
    RecurringExpense.countDocuments({ category: value }),
  ]);
  if (expenses || schedules) {
    if (!category.hidden) await writeSetting(category, { hidden: false });
    const uses = [expenses ? plural(expenses, "expense", "expenses") : "", schedules ? plural(schedules, "recurring schedule", "recurring schedules") : ""]
      .filter(Boolean)
      .join(" and ");
    throw new AppError(`${category.label} is used by ${uses}. Hide it instead, so those records keep their category.`, "conflict");
  }
  await ExpenseCategorySetting.deleteMany({ value });
  return { value };
}
