"use server";

import { defineAction } from "@/server/action";
import { AppError } from "@/server/errors";
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

/** Google Drive bills to draft expenses. Admins only, like every import. */

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
  { role: "admin", readOnly: true },
);

/** The drafts waiting for review, with what the review form needs. */
export const loadReceiptDraftsAction = defineAction(
  z.object({}),
  async (): Promise<ReceiptDraftsData> => {
    const [drafts, total, projects, categories] = await Promise.all([loadDrafts(), countOpenDrafts(), getProjectOptions(), getExpenseCategories()]);
    return { drafts, total: Math.max(total, drafts.length), projects, categories };
  },
  { role: "admin", readOnly: true },
);

/** Keeps edits on a draft without saving it as an expense. */
export const updateReceiptDraftAction = defineAction(
  updateDraftSchema,
  async ({ id, values }) => {
    await updateDraftValues(id, values);
    return { id };
  },
  // Drafts appear only on the import panel, which reloads them itself.
  { role: "admin", readOnly: true, message: "Draft kept" },
);

export const setReceiptDraftsCategoryAction = defineAction(
  setDraftsCategorySchema,
  async ({ ids, category }) => setDraftsCategory(ids, category),
  { role: "admin", readOnly: true },
);

/** Saves one draft as an expense (with its receipt), using the expense form's own create logic. */
export const saveReceiptDraftAction = defineAction(
  saveDraftSchema,
  async ({ id, values }, user) => {
    const result = await saveDraft(id, values, user, createExpense);
    if (!result.ok) throw new AppError(result.error, "invalid", result.fieldErrors);
    return { id, expenseId: result.expenseId, number: result.number };
  },
  { role: "admin", revalidate: REVALIDATE },
);

/** "Save all checked": each draft on its own; the answer says which were saved and why others were not. */
export const saveReceiptDraftsAction = defineAction(
  saveDraftsSchema,
  async ({ ids }, user) => saveDrafts(ids, user, createExpense),
  { role: "admin", revalidate: REVALIDATE },
);

/** Discards a draft and deletes its stored bill. */
export const discardReceiptDraftAction = defineAction(
  draftIdSchema,
  async ({ id }, user) => {
    await discardDraft(id, user);
    return { id };
  },
  { role: "admin", readOnly: true, message: "Draft discarded" },
);
