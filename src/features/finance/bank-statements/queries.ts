import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { BankAccount, BankPartyRule, BankStatement, BankTransaction, Project, User } from "@/server/models";
import { loadExpenseCategories } from "@/server/expense-categories";
import { toDateInput } from "@/lib/dates";
import { INCOME_CATEGORIES, type BankLineAction, type ProjectStage } from "@/lib/constants";
import type { PartyRuleRow, StatementPickers, StatementRow, StoredLine, StoredLineState } from "./types";
import type { BankLineKind } from "./kinds";
import { describeLinks } from "./server/links";
import { isReopenable } from "./server/claims";
import { loadPickers } from "./server/context";

/** Reads for the bank statement page. The page checks the bank statements view permission first. */

export async function getStatementPickers(): Promise<StatementPickers> {
  await connectDB();
  return loadPickers();
}

/**
 * Remembered parties, most recently used first. Without the salaries permission, parties
 * remembered as salary payments are left out: their names are the people paid.
 */
export async function listPartyRules(includeSalaries: boolean, limit = 500): Promise<PartyRuleRow[]> {
  await connectDB();
  const docs = await BankPartyRule.find(includeSalaries ? {} : { category: { $ne: "salaries" } })
    .sort({ lastUsedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  const projectIds = [...new Set(docs.flatMap((d) => (d.project ? [String(d.project)] : [])))].map((id) => new Types.ObjectId(id));
  const [projects, categories] = await Promise.all([projectIds.length ? Project.find({ _id: { $in: projectIds } }, { name: 1 }).lean() : [], loadExpenseCategories()]);
  const projectName = new Map(projects.map((p) => [String(p._id), p.name]));
  const label = (side: string, v: string | null | undefined) =>
    !v ? null : side === "in" ? (INCOME_CATEGORIES.find((c) => c.value === v)?.label ?? v) : (categories.find((c) => c.value === v)?.label ?? v);
  return docs.map((d) => ({
    id: String(d._id),
    side: d.side as "in" | "out",
    key: d.key,
    token: d.token ?? null,
    party: d.party,
    category: d.category ?? null,
    categoryLabel: label(d.side, d.category),
    projectId: d.project ? String(d.project) : null,
    projectName: d.project ? (projectName.get(String(d.project)) ?? "Deleted project") : null,
    stage: (d.stage as ProjectStage | undefined) ?? null,
    hits: d.hits ?? 0,
    lastUsedAt: d.lastUsedAt ? d.lastUsedAt.toISOString() : null,
  }));
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
        kind: (t.kind as BankLineKind | undefined) ?? null,
        row: typeof t.row === "number" ? t.row : null,
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
