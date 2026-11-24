import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { BankAccount, BankStatement, BankTransaction, User } from "@/server/models";
import { toDateInput } from "@/lib/dates";
import type { BankLineAction } from "@/lib/constants";
import type { StatementPickers, StatementRow, StoredLine, StoredLineState } from "./types";
import { describeLinks } from "./server/links";
import { isReopenable } from "./server/claims";
import { loadPickers } from "./server/context";

/** Reads for the bank statement page. The page checks the bank statements view permission first. */

export async function getStatementPickers(): Promise<StatementPickers> {
  await connectDB();
  return loadPickers();
}

/** Past uploads, newest first, optionally for one account. */
export async function listStatements(accountId?: string | null, limit = 100): Promise<StatementRow[]> {
  await connectDB();
  return statementRows(accountId && Types.ObjectId.isValid(accountId) ? { account: new Types.ObjectId(accountId) } : {}, limit);
}

async function statementRows(filter: Record<string, unknown>, limit: number): Promise<StatementRow[]> {
  const docs = await BankStatement.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  const [accounts, users] = await Promise.all([
    BankAccount.find({ _id: { $in: [...new Set(docs.map((d) => String(d.account)))].map((id) => new Types.ObjectId(id)) } }, { name: 1 }).lean(),
    User.find({ _id: { $in: docs.flatMap((d) => (d.createdBy ? [d.createdBy] : [])) } }, { name: 1 }).lean(),
  ]);
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const userName = new Map(users.map((u) => [String(u._id), (u as { name?: string }).name ?? null]));
  return docs.map((d) => ({
    id: String(d._id),
    accountId: String(d.account),
    accountName: accountName.get(String(d.account)) ?? "Deleted account",
    fileName: d.fileName ?? null,
    from: d.from ? toDateInput(d.from) : null,
    to: d.to ? toDateInput(d.to) : null,
    openingBalance: d.openingBalance ?? null,
    closingBalance: d.closingBalance ?? null,
    lines: d.lines ?? 0,
    added: d.added ?? 0,
    matched: d.matched ?? 0,
    ignored: d.ignored ?? 0,
    createdAt: d.createdAt.toISOString(),
    createdBy: d.createdBy ? (userName.get(String(d.createdBy)) ?? null) : null,
  }));
}

/** One past statement and the lines it added, with the record each became. */
export async function getStatementLines(id: string): Promise<{ statement: StatementRow; lines: StoredLine[] } | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const [statement] = await statementRows({ _id: new Types.ObjectId(id) }, 1);
  if (!statement) return null;
  const txns = await BankTransaction.find({ statement: new Types.ObjectId(id) }).sort({ date: 1, createdAt: 1 }).limit(5000).lean();
  const [info, unmatchers] = await Promise.all([
    describeLinks(txns.flatMap((t) => (t.link ? [{ kind: t.link.kind, id: String(t.link.id) }] : []))),
    User.find({ _id: { $in: [...new Set(txns.flatMap((t) => (!t.link && t.unmatchedBy ? [String(t.unmatchedBy)] : [])))].map((u) => new Types.ObjectId(u)) } }, { name: 1 }).lean(),
  ]);
  const unmatcherName = new Map(unmatchers.map((u) => [String(u._id), (u as { name?: string }).name ?? null]));
  return {
    statement,
    lines: txns.map((t) => {
      const i = t.link ? info.get(`${t.link.kind}:${t.link.id}`) : undefined;
      const state: StoredLineState = t.link
        ? i
          ? "linked"
          : "deleted"
        : t.action === "ignore"
          ? "ignored"
          : isReopenable(t)
            ? "review"
            : "adding";
      return {
        id: String(t._id),
        state,
        date: toDateInput(t.date),
        narration: t.narration ?? "",
        reference: t.reference ?? null,
        withdrawal: t.withdrawal ?? 0,
        deposit: t.deposit ?? 0,
        balance: t.balance ?? null,
        action: t.action as BankLineAction,
        label: i?.label ?? (t.link ? "Linked record was deleted" : null),
        href: i?.href ?? null,
        unmatchedAt: !t.link && t.unmatchedAt ? t.unmatchedAt.toISOString() : null,
        unmatchedBy: !t.link && t.unmatchedBy ? (unmatcherName.get(String(t.unmatchedBy)) ?? null) : null,
      };
    }),
  };
}

/**
 * The statement a line belongs to, for links to one line (/finance/bank-statements?line=<id>).
 * Null when the line does not exist or was never filed under a statement.
 */
export async function statementOfLine(id: string): Promise<string | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const t = await BankTransaction.findById(id, { statement: 1 }).lean();
  return t?.statement ? String(t.statement) : null;
}
