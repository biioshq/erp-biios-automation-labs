import "server-only";

import { Types } from "mongoose";
import { BankTransaction, Expense, Income, Invoice, Liability } from "@/server/models";
import { auditSafely, snapshotChanges, type AuditEntry } from "@/server/audit";
import type { AuditEntityType } from "@/lib/audit";
import { toDateInput } from "@/lib/dates";
import { describeLinks, type LinkRef } from "@/features/finance/bank-statements/server/links";
import type { AddLineValues } from "@/features/finance/bank-statements/schemas";
import { expenseLabel, incomeLabel, invoiceLabel, isSalary } from "./records";

/**
 * Audit entries for bank statement lines: one per record a line created, paid or was matched to
 * when lines are added, and one when a line is unmatched. Each entry names the statement and the
 * line, so every change can be traced back to the statement it came from.
 */

const oid = (id: string) => new Types.ObjectId(id);
const validIds = (ids: string[]) => [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map(oid);

/** The record a link points at, as the audit trail names it (a payment belongs to its expense, a repayment to its loan). */
type Target = {
  type: AuditEntityType;
  id: string;
  label: string | null;
  salary: boolean;
  payment?: string;
  /** The invoice an income record settles: its number for the entry, and the invoice for its own History. */
  invoice?: string | null;
  invoiceRef?: { id: string; label: string } | null;
};

const ENTITY_OF: Record<string, AuditEntityType> = {
  expense: "expense",
  expensePayment: "expense",
  income: "income",
  capitalEntry: "capital_entry",
  liability: "liability",
  liabilityPayment: "liability",
  accountTransfer: "account_transfer",
};

async function resolveTargets(refs: LinkRef[]): Promise<Map<string, Target>> {
  const out = new Map<string, Target>();
  const ids = (kind: string) => validIds(refs.filter((r) => r.kind === kind).map((r) => r.id));
  const [expenses, incomes, loans, info] = await Promise.all([
    Expense.find(
      { $or: [{ _id: { $in: ids("expense") } }, { "payments._id": { $in: ids("expensePayment") } }] },
      { number: 1, vendor: 1, category: 1, payments: 1 },
    ).lean(),
    Income.find({ _id: { $in: ids("income") } }, { number: 1, client: 1, invoice: 1 }).lean(),
    Liability.find({ "payments._id": { $in: ids("liabilityPayment") } }, { code: 1, name: 1, payments: 1 }).lean(),
    describeLinks(refs.filter((r) => ["capitalEntry", "liability", "accountTransfer"].includes(r.kind))),
  ]);
  const invoiceIds = incomes.flatMap((i) => (i.invoice ? [i.invoice] : []));
  const invoices = new Map(
    invoiceIds.length ? (await Invoice.find({ _id: { $in: invoiceIds } }, { number: 1, client: 1 }).lean()).map((v) => [String(v._id), v]) : [],
  );
  for (const e of expenses) {
    const t = { type: "expense" as const, id: String(e._id), label: expenseLabel(e), salary: isSalary(e.category) };
    out.set(`expense:${e._id}`, t);
    for (const p of e.payments ?? []) out.set(`expensePayment:${p._id}`, { ...t, payment: String(p._id) });
  }
  for (const i of incomes) {
    const invoice = i.invoice ? invoices.get(String(i.invoice)) : undefined;
    out.set(`income:${i._id}`, {
      type: "income",
      id: String(i._id),
      label: incomeLabel(i),
      salary: false,
      invoice: invoice?.number ?? null,
      invoiceRef: invoice ? { id: String(invoice._id), label: invoiceLabel(invoice) } : null,
    });
  }
  for (const l of loans) {
    for (const p of l.payments ?? []) {
      out.set(`liabilityPayment:${p._id}`, { type: "liability", id: String(l._id), label: `${l.code} · ${l.name}`, salary: false, payment: String(p._id) });
    }
  }
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    const i = info.get(key);
    if (i && !out.has(key)) out.set(key, { type: ENTITY_OF[r.kind], id: r.id, label: i.label, salary: false });
  }
  return out;
}

const lineNote = (l: { date: string; narration: string }) => `Bank line ${l.date}: ${l.narration}`;

type LineResult = { status: string; hash: string; link: LinkRef | null };

/** What adding one line did, as an audit entry. */
function lineEntry(l: AddLineValues, r: LineResult, target: Target, accountId: string): AuditEntry {
  const d = l.decision;
  const amount = l.withdrawal > 0 ? l.withdrawal : l.deposit;
  const kind = r.link!.kind;
  const base = { entity: { type: target.type, id: target.id, label: target.label }, salary: target.salary, note: lineNote(l), ref: { payment: target.payment } };
  if (r.status === "matched") {
    // A bill matched to the line is paid by it: a payment was added to the expense.
    if (kind === "expensePayment" && d.matchKey?.startsWith("bill:")) {
      return {
        ...base,
        action: "paid",
        changes: snapshotChanges({ paidAmount: amount, paidOn: l.date, paymentMethod: d.paymentMethod, account: accountId }, "to"),
      };
    }
    return { ...base, action: "matched" };
  }
  const fields: Record<string, unknown> =
    kind === "expense"
      ? { vendor: d.party, amount, date: l.date, category: d.category, project: d.projectId, stage: d.projectId ? d.stage : null, paymentMethod: d.paymentMethod, account: accountId }
      : kind === "income"
        ? { client: d.party, amount, date: l.date, incomeCategory: d.incomeCategory ?? "project_payment", project: d.projectId, paymentMethod: d.paymentMethod, account: accountId, invoice: target.invoice }
        : kind === "liabilityPayment"
          ? { paidAmount: amount, paidOn: l.date, paymentMethod: d.paymentMethod, account: accountId }
          : { amount, date: l.date, account: accountId };
  return { ...base, action: kind === "liabilityPayment" ? "paid" : "imported", changes: snapshotChanges(fields, "to") };
}

/**
 * After a batch of lines is added: one entry per line that made, paid or matched a record. Lines
 * already imported, ignored or failed leave no entry. Never throws.
 */
export async function auditStatementLines(
  accountId: string,
  lines: AddLineValues[],
  results: LineResult[],
  statementId: Types.ObjectId | string | null,
): Promise<void> {
  await auditSafely(async () => {
    const done = results.flatMap((r, i) => (r.link && lines[i] && (r.status === "added" || r.status === "matched") ? [{ r, l: lines[i] }] : []));
    if (!done.length) return null;
    const [targets, txns] = await Promise.all([
      resolveTargets(done.map((x) => x.r.link!)),
      BankTransaction.find({ account: oid(accountId), hash: { $in: done.map((x) => x.r.hash) } }, { hash: 1 }).lean(),
    ]);
    const lineOf = new Map(txns.map((t) => [t.hash, String(t._id)]));
    return done.flatMap(({ r, l }) => {
      const target = targets.get(`${r.link!.kind}:${r.link!.id}`);
      if (!target) return [];
      const entry = lineEntry(l, r, target, accountId);
      const ref = { statement: statementId ? String(statementId) : undefined, line: lineOf.get(r.hash) };
      const out: AuditEntry[] = [{ ...entry, source: "bank_statement", ref: { ...entry.ref, ...ref } }];
      // A receipt added from the statement and applied to an invoice shows on the invoice too.
      if (r.status === "added" && target.invoiceRef) {
        out.push({
          action: "linked",
          entity: { type: "invoice", id: target.invoiceRef.id, label: target.invoiceRef.label },
          note: `Receipt ${target.label ?? target.id} applied from the bank statement`,
          source: "bank_statement",
          ref: { ...ref, income: target.id },
        });
      }
      return out;
    });
  });
}

/** After a line is unmatched from its record: one entry on the record. Never throws. */
export async function auditUnmatch(lineId: Types.ObjectId | string, link: { kind: string; id: Types.ObjectId | string }): Promise<void> {
  await auditSafely(async () => {
    const ref = { kind: link.kind, id: String(link.id) };
    const [targets, line] = await Promise.all([
      resolveTargets([ref]),
      BankTransaction.findById(lineId, { date: 1, narration: 1, statement: 1, withdrawal: 1, deposit: 1 }).lean(),
    ]);
    const target = targets.get(`${ref.kind}:${ref.id}`);
    if (!target) return null;
    return {
      action: "unmatched",
      entity: { type: target.type, id: target.id, label: target.label },
      salary: target.salary,
      note: line ? `${lineNote({ date: toDateInput(line.date), narration: line.narration ?? "" })}. The record is unchanged.` : "The record is unchanged.",
      ref: { line: String(lineId), statement: line?.statement ? String(line.statement) : undefined, payment: target.payment },
    };
  });
}
