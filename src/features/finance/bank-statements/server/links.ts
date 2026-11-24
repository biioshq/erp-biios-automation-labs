import "server-only";

import { Types } from "mongoose";
import { AccountTransfer, BankAccount, CapitalEntry, Expense, Income, Liability } from "@/server/models";
import { CAPITAL_ENTRY_TYPES, labelOf, type CapitalEntryType } from "@/lib/constants";

/**
 * What a statement line became, as a label and a link: the record's number and party, opened on
 * its own page (?view=<id>, the detail URLs every finance page answers to).
 */

export type LinkRef = { kind: string; id: string };
export type LinkInfo = { label: string; href: string };

const oid = (id: string) => new Types.ObjectId(id);
const ids = (refs: LinkRef[], kind: string) => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))].filter((id) => Types.ObjectId.isValid(id)).map(oid);

/** Labels and links for many links at once, keyed "<kind>:<id>". Records deleted since are left out. */
export async function describeLinks(refs: LinkRef[]): Promise<Map<string, LinkInfo>> {
  const out = new Map<string, LinkInfo>();
  if (!refs.length) return out;
  const [expenses, paidExpenses, incomes, entries, loans, paidLoans, transfers] = await Promise.all([
    Expense.find({ _id: { $in: ids(refs, "expense") } }, { number: 1, vendor: 1 }).lean(),
    Expense.find({ "payments._id": { $in: ids(refs, "expensePayment") } }, { number: 1, vendor: 1, payments: 1 }).lean(),
    Income.find({ _id: { $in: ids(refs, "income") } }, { number: 1, client: 1 }).lean(),
    CapitalEntry.find({ _id: { $in: ids(refs, "capitalEntry") } }, { number: 1, type: 1 }).lean(),
    Liability.find({ _id: { $in: ids(refs, "liability") } }, { code: 1, name: 1 }).lean(),
    Liability.find({ "payments._id": { $in: ids(refs, "liabilityPayment") } }, { code: 1, name: 1, payments: 1 }).lean(),
    AccountTransfer.find({ _id: { $in: ids(refs, "accountTransfer") } }, { from: 1, to: 1 }).lean(),
  ]);
  for (const e of expenses) out.set(`expense:${e._id}`, { label: `${e.number} · ${e.vendor}`, href: `/finance/expenses?view=${e._id}` });
  for (const e of paidExpenses) {
    for (const p of e.payments ?? []) out.set(`expensePayment:${p._id}`, { label: `Payment on ${e.number} · ${e.vendor}`, href: `/finance/expenses?view=${e._id}` });
  }
  for (const i of incomes) out.set(`income:${i._id}`, { label: `${i.number} · ${i.client}`, href: `/finance/income?view=${i._id}` });
  for (const c of entries) {
    out.set(`capitalEntry:${c._id}`, { label: `${c.number} · ${labelOf(CAPITAL_ENTRY_TYPES, c.type as CapitalEntryType)}`, href: `/finance/equity?view=${c._id}` });
  }
  for (const l of loans) out.set(`liability:${l._id}`, { label: `${l.code} · ${l.name}`, href: `/finance/liabilities/loans?view=${l._id}` });
  for (const l of paidLoans) {
    for (const p of l.payments ?? []) out.set(`liabilityPayment:${p._id}`, { label: `Repayment on ${l.code} · ${l.name}`, href: `/finance/liabilities/loans?view=${l._id}` });
  }
  if (transfers.length) {
    const accountIds = [...new Set(transfers.flatMap((t) => [String(t.from), String(t.to)]))].map(oid);
    const names = new Map((await BankAccount.find({ _id: { $in: accountIds } }, { name: 1 }).lean()).map((a) => [String(a._id), a.name]));
    for (const t of transfers) {
      out.set(`accountTransfer:${t._id}`, {
        label: `Transfer from ${names.get(String(t.from)) ?? "an account"} to ${names.get(String(t.to)) ?? "an account"}`,
        href: "/finance/assets/cash",
      });
    }
  }
  return out;
}

/** True while the record a line became still exists. */
export async function linkExists(ref: LinkRef): Promise<boolean> {
  return (await describeLinks([ref])).has(`${ref.kind}:${ref.id}`);
}
