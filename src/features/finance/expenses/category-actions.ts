"use server";

import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  createExpenseCategory,
  deleteExpenseCategory,
  getExpenseCategoryUsage,
  loadExpenseCategories,
  renameExpenseCategory,
  setExpenseCategoryHidden,
  setExpenseCategoryNature,
} from "@/server/expense-categories";
import { auditCategoryChange } from "@/features/finance/audit/settings";
import {
  expenseCategoryCreateSchema,
  expenseCategoryHiddenSchema,
  expenseCategoryNatureSchema,
  expenseCategoryRenameSchema,
  expenseCategoryValueOnlySchema,
} from "./schemas";

/** Categories show across Finance (expenses, recurring, dashboard, project tabs and reports). */
const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/** The category as it is before a change, for the audit trail. */
const before = async (value: string) => (await loadExpenseCategories()).find((c) => c.value === value) ?? null;

export const addExpenseCategory = defineAction(
  expenseCategoryCreateSchema,
  async ({ label }, user) => {
    const created = await createExpenseCategory(label, user.id);
    await auditCategoryChange(null, created);
    return created;
  },
  { revalidate: REVALIDATE, message: "Category added", permission: "finance.expense_categories:create" },
);

export const renameExpenseCategoryAction = defineAction(
  expenseCategoryRenameSchema,
  async ({ value, label }) => {
    const old = await before(value);
    const renamed = await renameExpenseCategory(value, label);
    await auditCategoryChange(old, renamed);
    return renamed;
  },
  { revalidate: REVALIDATE, message: "Category renamed", permission: "finance.expense_categories:edit" },
);

export const setExpenseCategoryHiddenAction = defineAction(
  expenseCategoryHiddenSchema,
  async ({ value, hidden }) => {
    const old = await before(value);
    const changed = await setExpenseCategoryHidden(value, hidden);
    await auditCategoryChange(old, changed);
    return changed;
  },
  { revalidate: REVALIDATE, permission: "finance.expense_categories:edit" },
);

/** Direct or indirect: changes how every expense of the category without a project is classed, past ones included. */
export const setExpenseCategoryNatureAction = defineAction(
  expenseCategoryNatureSchema,
  async ({ value, nature }) => {
    const old = await before(value);
    const changed = await setExpenseCategoryNature(value, nature);
    await auditCategoryChange(old, changed);
    return changed;
  },
  { revalidate: REVALIDATE, permission: "finance.expense_categories:edit" },
);

export const deleteExpenseCategoryAction = defineAction(
  expenseCategoryValueOnlySchema,
  async ({ value }) => {
    const old = await before(value);
    const deleted = await deleteExpenseCategory(value);
    await auditCategoryChange(old, null);
    return deleted;
  },
  { revalidate: REVALIDATE, message: "Category deleted", permission: "finance.expense_categories:delete" },
);

/** Usage counts for the categories dialog. Read-only. */
export const fetchExpenseCategoryUsage = defineAction(z.object({}), async () => getExpenseCategoryUsage(), {
  permission: "finance.expense_categories:view",
  readOnly: true,
});
