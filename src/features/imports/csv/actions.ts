"use server";

import { defineAction } from "@/server/action";
import { AppError } from "@/server/errors";
import { can, type SessionUser } from "@/server/auth/session";
import { csvImportSchema, csvPreviewSchema, type ImportResult, type PreviewResult } from "./schemas";
import type { CsvImportKind } from "./fields";
import { importRows, previewRows } from "./server";

/**
 * Expenses and income are imported on the Finance Import page, items on the Inventory Import page.
 * Each kind needs the import permission of its own area.
 */
const IMPORT_PERMISSIONS = ["finance.import:create", "inventory.import:create"];

function assertMayImport(user: SessionUser, kind: CsvImportKind) {
  if (!can(user, kind === "items" ? "inventory.import:create" : "finance.import:create")) {
    throw new AppError("You do not have permission to do this.", "forbidden");
  }
}

/** The dry run: reads and checks rows, and looks for records they would repeat. Saves nothing. */
export const previewCsvImport = defineAction(
  csvPreviewSchema,
  async ({ kind, rows, options }, user): Promise<PreviewResult> => {
    assertMayImport(user, kind);
    return { rows: await previewRows(kind, rows, options) };
  },
  { permission: IMPORT_PERMISSIONS, readOnly: true },
);

/**
 * Saves one batch of reviewed rows, each on its own: a row that fails is reported and the rest are
 * still saved. Each row goes through the record's own create action, so its permission applies too.
 */
export const importCsvBatch = defineAction(
  csvImportSchema,
  async ({ kind, rows, options }, user): Promise<ImportResult> => {
    assertMayImport(user, kind);
    // New expense categories named in the file are added only for people who may add categories.
    const allowed = kind === "items" || can(user, "finance.expense_categories:create");
    return importRows(kind, rows, { ...options, createCategories: options.createCategories && allowed }, user.id);
  },
  {
    permission: IMPORT_PERMISSIONS,
    revalidate: [
      ["/finance", "layout"],
      ["/inventory", "layout"],
    ],
  },
);
