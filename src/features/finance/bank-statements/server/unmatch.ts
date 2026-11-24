import "server-only";

import { Types } from "mongoose";
import { AccountTransfer, BankStatement, BankTransaction, CapitalEntry, Expense, Income, Liability } from "@/server/models";
import { AppError, notFound } from "@/server/errors";
import { toDateInput } from "@/lib/dates";
import type { StatementLine, UnmatchResult } from "../types";
import { STALE_CLAIM_MS } from "./claims";
import { lineHash } from "./hash";
import { describeLinks } from "./links";

/**
 * Unmatching a statement line: the line stops pointing at the record it became, and the record
 * stops pointing at the line. Nothing else changes. The record keeps its amount, date, account and
 * payments, so the books read exactly as before; it can then be edited or deleted on its own page,
 * and the line can be reviewed and added again (where the record, while it exists, is offered as
 * "Already recorded").
 */

/** Statement lines identical before this one in their file: tried in turn to find the stored line's hash. */
const MAX_OCCURRENCE = 50;

/** The field of BankStatement that counted the line. */
const countField = (action: string) => (action === "ignore" ? "ignored" : action === "match" ? "matched" : "added");

/**
 * Removes every pointer at this line from the records. A line id is unique, so whatever points at
 * it is this line's back-link: the record it became, the payment it added or was matched to, the
 * interest expense a loan repayment booked with it, a transfer's list of lines. Safe to repeat.
 */
async function clearBackLinks(txn: Types.ObjectId): Promise<void> {
  // Without timestamps: the records themselves do not change, so their updatedAt stays as it was.
  const quiet = { timestamps: false };
  const inPayments = { arrayFilters: [{ "p.bankTransaction": txn }], timestamps: false };
  await Promise.all([
    Expense.updateMany({ bankTransaction: txn }, { $unset: { bankTransaction: 1 } }, quiet),
    Expense.updateMany({ "payments.bankTransaction": txn }, { $unset: { "payments.$[p].bankTransaction": 1 } }, inPayments),
    Income.updateMany({ bankTransaction: txn }, { $unset: { bankTransaction: 1 } }, quiet),
    CapitalEntry.updateMany({ bankTransaction: txn }, { $unset: { bankTransaction: 1 } }, quiet),
    Liability.updateMany({ bankTransaction: txn }, { $unset: { bankTransaction: 1 } }, quiet),
    Liability.updateMany({ "payments.bankTransaction": txn }, { $unset: { "payments.$[p].bankTransaction": 1 } }, inPayments),
    AccountTransfer.updateMany({ bankTransactions: txn }, { $pull: { bankTransactions: txn } }, quiet),
  ]);
}

/**
 * Unmatches one committed line. Admin only (the action checks). Safe to repeat: a second click
 * finds the line already unmatched and changes nothing.
 *
 * The back-links are cleared first and the line last, so a request cut off half way leaves the
 * line still linked and pressing Unmatch again finishes it. The line keeps what it was (its action
 * and statement), loses its link and gets unmatchedAt and unmatchedBy: that marker is how the add
 * (commit.ts), the review (review.ts) and the statement page tell an unmatched line from one being
 * added right now (claims.ts). Its time is also set back past the claim window, as older versions
 * of this code expected.
 */
export async function unmatchLine(id: string, userId: string): Promise<UnmatchResult> {
  if (!Types.ObjectId.isValid(id)) throw notFound("The statement line");
  const _id = new Types.ObjectId(id);
  const line = await BankTransaction.findById(_id, { link: 1, action: 1, statement: 1 }).lean();
  if (!line) throw notFound("The statement line");
  if (!line.link) {
    if (line.action === "ignore") throw new AppError("This line was ignored, so it is not tied to any record.", "invalid");
    return { status: "already", message: "This line is already unmatched. Review it to add it again." };
  }
  const info = await describeLinks([{ kind: line.link.kind, id: String(line.link.id) }]);
  const label = info.get(`${line.link.kind}:${line.link.id}`)?.label ?? null;

  await clearBackLinks(_id);
  const done = await BankTransaction.findOneAndUpdate(
    { _id, link: { $exists: true } },
    {
      // A user id that is not an ObjectId leaves no name, and no name from an earlier unmatch either.
      $unset: Types.ObjectId.isValid(userId) ? { link: 1 } : { link: 1, unmatchedBy: 1 },
      $set: {
        unmatchedAt: new Date(),
        ...(Types.ObjectId.isValid(userId) ? { unmatchedBy: new Types.ObjectId(userId) } : {}),
        updatedAt: new Date(Date.now() - STALE_CLAIM_MS - 60_000),
      },
    },
    { timestamps: false, returnDocument: "before", projection: { action: 1, statement: 1 } },
  ).lean();
  if (!done) return { status: "already", message: "This line is already unmatched. Review it to add it again." };
  if (done.statement) {
    const field = countField(done.action);
    // Bookkeeping of the counts only: the line is unmatched either way.
    await BankStatement.updateOne({ _id: done.statement, [field]: { $gt: 0 } }, { $inc: { [field]: -1 } }).catch((e: unknown) =>
      console.error("[bank-statements] could not update a count", e),
    );
  }
  return {
    status: "unmatched",
    message: label ? `Unmatched from ${label}. The record is unchanged.` : "Unmatched. The record it pointed at was already deleted.",
  };
}

/**
 * A stored line as the review and the add take it, with the occurrence that gives its stored hash.
 * Null when the hash cannot be rebuilt (a line saved by an older version): upload the statement
 * again to review it.
 */
export async function storedStatementLine(id: string): Promise<{ accountId: string; statementId: string | null; line: StatementLine; occurrence: number } | null> {
  if (!Types.ObjectId.isValid(id)) throw notFound("The statement line");
  const t = await BankTransaction.findById(id).lean();
  if (!t) throw notFound("The statement line");
  const accountId = String(t.account);
  const line: StatementLine = {
    line: 0,
    date: toDateInput(t.date),
    narration: t.narration ?? "",
    reference: t.reference || undefined,
    withdrawal: t.withdrawal ?? 0,
    deposit: t.deposit ?? 0,
    balance: typeof t.balance === "number" ? t.balance : null,
    check: "unchecked",
    issues: [],
  };
  for (let n = 0; n <= MAX_OCCURRENCE; n++) {
    if (lineHash(accountId, line, n) === t.hash) return { accountId, statementId: t.statement ? String(t.statement) : null, line, occurrence: n };
  }
  return null;
}
