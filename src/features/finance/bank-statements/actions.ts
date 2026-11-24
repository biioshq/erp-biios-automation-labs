"use server";

import { AppError, notFound } from "@/server/errors";
import { defineAction } from "@/server/action";
import { addLinesSchema, reviewStatementSchema, statementLineIdSchema } from "./schemas";
import type { StoredLineReview } from "./types";
import { reviewLines } from "./server/review";
import { addStatementLines } from "./server/commit";
import { storedStatementLine, unmatchLine } from "./server/unmatch";

/**
 * Bank statement actions. Admin only: a statement turns into expenses, income, capital, loans and
 * transfers across Finance. The review reads only; adding is safe to repeat (see server/commit.ts).
 */

export const reviewStatement = defineAction(reviewStatementSchema, async ({ accountId, lines }) => reviewLines(accountId, lines), {
  role: "admin",
  readOnly: true,
});

export const addStatementBatch = defineAction(addLinesSchema, async (input, user) => addStatementLines(input, user.id), {
  role: "admin",
  revalidate: [["/finance", "layout"]],
});

/** Unties a line from its record. The record itself is never changed or deleted (see server/unmatch.ts). */
export const unmatchStatementLine = defineAction(statementLineIdSchema, async ({ id }, user) => unmatchLine(id, user.id), {
  role: "admin",
  revalidate: [["/finance", "layout"]],
});

/** Reviews one stored line again on its statement's page, as an upload would. Reads only. */
export const reviewStoredLine = defineAction(
  statementLineIdSchema,
  async ({ id }): Promise<StoredLineReview> => {
    const stored = await storedStatementLine(id);
    if (!stored) throw new AppError("This line cannot be reviewed here. Upload the statement again to review it.", "invalid");
    const { lines, pickers } = await reviewLines(stored.accountId, [stored.line], { occurrences: [stored.occurrence], stored: true });
    const line = lines[0];
    if (!line) throw notFound("The statement line");
    if (line.imported) throw new AppError("This line is tied to a record already. Unmatch it first to review it again.", "conflict");
    return { accountId: stored.accountId, statementId: stored.statementId, line, pickers };
  },
  { role: "admin", readOnly: true },
);
