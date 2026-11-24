"use server";

import { defineAction } from "@/server/action";
import { AppError } from "@/server/errors";
import { can } from "@/server/auth/session";
import { assertMaySalary } from "@/features/finance/expenses/server";
import { getProjectOptions } from "@/server/lookups";
import { getExpenseCategories } from "@/server/expense-categories";
import { createExpense } from "@/features/finance/expenses/actions";
import {
  draftIdSchema,
  listDriveReceiptsSchema,
  saveDraftSchema,
  saveDraftsSchema,
  setDraftsCategorySchema,
  updateDraftSchema,
} from "./schemas";
import {
  asAppError,
  countOpenDrafts,
  discardDraft,
  listDriveReceipts,
  loadDrafts,
  saveDraft,
  saveDrafts,
  setDraftsCategory,
  updateDraftValues,
} from "./server";
import type { ReceiptDraftsData } from "./types";
import { z } from "zod";

/** Google Drive bills to draft expenses. Needs the Finance import permission; saving a draft also needs expense create. */

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/** Lists a shared Drive folder (or one file) and says which files are new. */
export const listDriveReceiptsAction = defineAction(
  listDriveReceiptsSchema,
  async ({ link }) => {
    try {
      return await listDriveReceipts(link);
    } catch (error) {
      throw asAppError(error);
    }
  },
  { permission: "finance.import:create", readOnly: true },
);

/** The drafts waiting for review, with what the review form needs. */
export const loadReceiptDraftsAction = defineAction(
  z.object({}),
  async (_input, user): Promise<ReceiptDraftsData> => {
    const [all, total, projects, categories] = await Promise.all([loadDrafts(), countOpenDrafts(), getProjectOptions(), getExpenseCategories()]);
    // A draft filed under salaries is someone's pay: it is listed only with the salaries data permission.
    const drafts = can(user, "data.salaries") ? all : all.filter((d) => d.values.category !== "salaries");
    return { drafts, total: Math.max(total, drafts.length), projects, categories };
  },
  { permission: "finance.import:create", readOnly: true },
);

/** Keeps edits on a draft without saving it as an expense. */
export const updateReceiptDraftAction = defineAction(
  updateDraftSchema,
  async ({ id, values }, user) => {
    assertMaySalary(user, values.category);
    await updateDraftValues(id, values);
    return { id };
  },
  // Drafts appear only on the import panel, which reloads them itself.
  { permission: "finance.import:create", readOnly: true, message: "Draft kept" },
);

export const setReceiptDraftsCategoryAction = defineAction(
  setDraftsCategorySchema,
  async ({ ids, category }, user) => {
    assertMaySalary(user, category);
    return setDraftsCategory(ids, category);
  },
  { permission: "finance.import:create", readOnly: true },
);

/** Saves one draft as an expense (with its receipt), using the expense form's own create logic. */
export const saveReceiptDraftAction = defineAction(
  saveDraftSchema,
  async ({ id, values }, user) => {
    const result = await saveDraft(id, values, user, createExpense);
    if (!result.ok) throw new AppError(result.error, "invalid", result.fieldErrors);
    return { id, expenseId: result.expenseId, number: result.number };
  },
  { permission: "finance.import:create", revalidate: REVALIDATE },
);

/** "Save all checked": each draft on its own; the answer says which were saved and why others were not. */
export const saveReceiptDraftsAction = defineAction(
  saveDraftsSchema,
  async ({ ids }, user) => saveDrafts(ids, user, createExpense),
  { permission: "finance.import:create", revalidate: REVALIDATE },
);

/** Discards a draft and deletes its stored bill. */
export const discardReceiptDraftAction = defineAction(
  draftIdSchema,
  async ({ id }, user) => {
    await discardDraft(id, user);
    return { id };
  },
  { permission: "finance.import:create", readOnly: true, message: "Draft discarded" },
);
