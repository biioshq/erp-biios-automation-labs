"use server";

import { z } from "zod";
import { defineAction } from "@/server/action";
import {
  createExpenseCategory,
  deleteExpenseCategory,
  getExpenseCategoryUsage,
  renameExpenseCategory,
  setExpenseCategoryHidden,
} from "@/server/expense-categories";
import {
  expenseCategoryCreateSchema,
  expenseCategoryHiddenSchema,
  expenseCategoryRenameSchema,
  expenseCategoryValueOnlySchema,
} from "./schemas";

/** Categories show across Finance (expenses, recurring, dashboard, project tabs and reports). */
const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

export const addExpenseCategory = defineAction(expenseCategoryCreateSchema, async ({ label }, user) => createExpenseCategory(label, user.id), {
  revalidate: REVALIDATE,
  message: "Category added",
  role: "admin",
});

export const renameExpenseCategoryAction = defineAction(expenseCategoryRenameSchema, async ({ value, label }) => renameExpenseCategory(value, label), {
  revalidate: REVALIDATE,
  message: "Category renamed",
  role: "admin",
});

export const setExpenseCategoryHiddenAction = defineAction(
  expenseCategoryHiddenSchema,
  async ({ value, hidden }) => setExpenseCategoryHidden(value, hidden),
  { revalidate: REVALIDATE, role: "admin" },
);

export const deleteExpenseCategoryAction = defineAction(expenseCategoryValueOnlySchema, async ({ value }) => deleteExpenseCategory(value), {
  revalidate: REVALIDATE,
  message: "Category deleted",
  role: "admin",
});

/** Usage counts for the categories dialog. Read-only. */
export const fetchExpenseCategoryUsage = defineAction(z.object({}), async () => getExpenseCategoryUsage(), { role: "admin", readOnly: true });
