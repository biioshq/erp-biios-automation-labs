"use server";

import { AppError, notFound } from "@/server/errors";
import { defineAction } from "@/server/action";
import { can, type SessionUser } from "@/server/auth/session";
import type { BankLineAction } from "@/lib/constants";
import { addLinesSchema, reviewStatementSchema, statementLineIdSchema, type AddLineValues } from "./schemas";
import type { StoredLineReview } from "./types";
import { reviewLines } from "./server/review";
import { addStatementLines } from "./server/commit";
import { storedStatementLine, unmatchLine } from "./server/unmatch";

/**
 * Bank statement actions. A statement turns into expenses, income, capital, loans and transfers
 * across Finance, so uploading and adding lines needs the bank statements create permission. The
 * review reads only; adding is safe to repeat (see server/commit.ts).
 */

/** The record each line action makes, by the permission that record needs on its own page. */
const LINE_PERMISSIONS: Partial<Record<BankLineAction, { permission: string; what: string }>> = {
  expense: { permission: "finance.expenses:create", what: "expenses" },
  income: { permission: "finance.income:create", what: "income" },
  capital: { permission: "finance.equity:create", what: "capital entries" },
  drawing: { permission: "finance.equity:create", what: "owner drawings" },
  loan_received: { permission: "finance.liabilities:create", what: "loans" },
  loan_payment: { permission: "finance.liabilities:edit", what: "loan repayments" },
  transfer: { permission: "finance.cash_bank:create", what: "transfers between accounts" },
};

/**
 * Adding a line makes the same record its own page would, so the person also needs that page's
 * permission: a role with bank statements but without, say, Capital / Equity cannot add capital
 * through a statement. Checked for the whole batch before anything is written.
 */
function assertMayAddLines(user: SessionUser, lines: AddLineValues[]) {
  const missing = new Set<string>();
  for (const l of lines) {
    const d = l.decision;
    const need = LINE_PERMISSIONS[d.action];
    if (need && !can(user, need.permission)) missing.add(need.what);
    if (d.action === "expense" && d.category === "salaries" && !can(user, "data.salaries")) missing.add("salary expenses");
    // "Already recorded" against an unpaid bill records a payment on it.
    if (d.action === "match" && d.matchKey?.startsWith("bill:") && !can(user, "finance.payments:create")) missing.add("bill payments");
  }
  if (missing.size) {
    throw new AppError(`Your role cannot add ${[...missing].join(", ")}. Choose Ignore for those lines, or ask an admin to add them.`, "forbidden");
  }
}

export const reviewStatement = defineAction(reviewStatementSchema, async ({ accountId, lines }) => reviewLines(accountId, lines), {
  permission: "finance.bank_statements:create",
  readOnly: true,
});

export const addStatementBatch = defineAction(
  addLinesSchema,
  async (input, user) => {
    assertMayAddLines(user, input.lines);
    return addStatementLines(input, user.id);
  },
  { permission: "finance.bank_statements:create", revalidate: [["/finance", "layout"]] },
);

/** Unties a line from its record. The record itself is never changed or deleted (see server/unmatch.ts). */
export const unmatchStatementLine = defineAction(statementLineIdSchema, async ({ id }, user) => unmatchLine(id, user.id), {
  permission: "finance.bank_statements:edit",
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
  // Reviewing a stored line again leads to adding it, like an upload.
  { permission: "finance.bank_statements:create", readOnly: true },
);
