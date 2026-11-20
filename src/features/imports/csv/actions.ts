"use server";

import { defineAction } from "@/server/action";
import { csvImportSchema, csvPreviewSchema, type ImportResult, type PreviewResult } from "./schemas";
import { importRows, previewRows } from "./server";

/** The dry run: reads and checks rows, and looks for records they would repeat. Saves nothing. Admin only. */
export const previewCsvImport = defineAction(
  csvPreviewSchema,
  async ({ kind, rows, options }): Promise<PreviewResult> => ({ rows: await previewRows(kind, rows, options) }),
  { role: "admin", readOnly: true },
);

/**
 * Saves one batch of reviewed rows, each on its own: a row that fails is reported and the rest are
 * still saved. Admin only, like every import.
 */
export const importCsvBatch = defineAction(
  csvImportSchema,
  async ({ kind, rows, options }, user): Promise<ImportResult> => importRows(kind, rows, options, user.id),
  {
    role: "admin",
    revalidate: [
      ["/finance", "layout"],
      ["/inventory", "layout"],
    ],
  },
);
