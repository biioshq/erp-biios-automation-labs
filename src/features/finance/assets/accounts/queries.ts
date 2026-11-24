import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { AccountTransfer, BankAccount, BankTransaction } from "@/server/models";
import { loadAccountBook, UNASSIGNED_BANK, UNASSIGNED_CASH } from "@/server/accounts";
import { accountHistory, cashBalances } from "@/server/accounting/statements";
import { effectiveAsOf } from "@/server/accounting/ledger";
import { PAYMENT_METHODS, labelOf, type BankAccountKind } from "@/lib/constants";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { DEFAULT_FOR_METHODS, type DefaultForMethod } from "./schemas";
import type { AccountHistory, AccountOption, AccountRow, BankAccountDetail, CashOverview, MethodRoute, TransferRow } from "./types";

const isDefaultFor = (m: string): m is DefaultForMethod => (DEFAULT_FOR_METHODS as readonly string[]).includes(m);

/** Every account with its balance today (from the accounting engine), the totals, and where unlinked records land. */
export async function getCashOverview(): Promise<CashOverview> {
  await connectDB();
  const [balances, docs, book] = await Promise.all([cashBalances(), BankAccount.find({}).lean(), loadAccountBook()]);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const accounts: AccountRow[] = balances.map((b) => {
    const d = b.id ? byId.get(b.id) : undefined;
    return {
      code: b.code,
      id: b.id,
      name: b.name,
      kind: b.kind,
      archived: b.archived,
      balance: round2(b.balance),
      openingBalance: b.openingBalance,
      openingDate: b.openingDate,
      bankName: d?.bankName ?? null,
      accountLast4: d?.accountLast4 ?? null,
      ifsc: d?.ifsc ?? null,
      defaultFor: (d?.defaultFor ?? []).filter(isDefaultFor),
      notes: d?.notes ?? null,
    };
  });
  // Open accounts first, then archived, then the fallbacks; bank before cash inside each.
  const rank = (a: AccountRow) => (a.id ? (a.archived ? 1 : 0) : 2);
  accounts.sort((a, b) => rank(a) - rank(b) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  const sumOf = (kind: BankAccountKind) => round2(accounts.filter((a) => a.kind === kind).reduce((s, a) => s + a.balance, 0));
  const cashInHand = sumOf("cash");
  const bankBalance = sumOf("bank");

  const routes: MethodRoute[] = DEFAULT_FOR_METHODS.map((method) => {
    const code = book.resolve(method, null);
    const account = code ? book.byCode.get(code) : undefined;
    const reason: MethodRoute["reason"] = docs.some((d) => (d.defaultFor ?? []).includes(method))
      ? "default"
      : code === UNASSIGNED_CASH || code === UNASSIGNED_BANK
        ? "not_set_up"
        : "first_of_kind";
    // An archived account keeps its defaults, so say so: new records still land in it.
    const accountName = account ? `${account.name}${account.archived ? " (archived)" : ""}` : "No account";
    return { method, label: labelOf(PAYMENT_METHODS, method), accountName, reason };
  });

  return {
    asOf: toDateInput(effectiveAsOf(null)),
    accounts,
    cashInHand,
    bankBalance,
    total: round2(cashInHand + bankBalance),
    noAccounts: docs.length === 0,
    usesFallback: accounts.some((a) => !a.id),
    routes,
  };
}

/** Transfers between own accounts, newest first. */
export async function listTransfers(limit = 200): Promise<{ rows: TransferRow[]; total: number }> {
  await connectDB();
  const [docs, total, accounts] = await Promise.all([
    AccountTransfer.find({}).sort({ date: -1, _id: -1 }).limit(limit).lean(),
    AccountTransfer.countDocuments({}),
    BankAccount.find({}, { name: 1 }).lean(),
  ]);
  const names = new Map(accounts.map((a) => [String(a._id), a.name]));
  const ref = (id: Types.ObjectId | null | undefined) => (id && names.has(String(id)) ? { id: String(id), name: names.get(String(id))! } : null);
  // A line tied to a transfer is listed on the transfer; a line whose link alone points at it (older data) counts too.
  const pointing = docs.length
    ? await BankTransaction.find({ "link.kind": "accountTransfer", "link.id": { $in: docs.map((t) => t._id) } }, { link: 1 }).lean()
    : [];
  const linesOf = new Map<string, string[]>();
  for (const t of pointing) {
    const key = String(t.link!.id);
    linesOf.set(key, [...(linesOf.get(key) ?? []), String(t._id)]);
  }
  return {
    total,
    rows: docs.map((t) => {
      const lines = [...new Set([...(t.bankTransactions ?? []).map(String), ...(linesOf.get(String(t._id)) ?? [])])];
      return {
        id: String(t._id),
        date: toDateInput(t.date),
        amount: t.amount,
        from: ref(t.from),
        to: ref(t.to),
        reference: t.reference ?? null,
        notes: t.notes ?? null,
        fromStatement: lines.length > 0,
        bankTransactionIds: lines,
      };
    }),
  };
}

/**
 * One account's postings between two days with the running balance, from the accounting engine.
 * `code` must be one of the accounts on the page; anything else returns null.
 */
export async function getAccountHistory(code: string, from: string | null, to: string | null, accounts: AccountRow[]): Promise<AccountHistory | null> {
  const account = accounts.find((a) => a.code === code);
  if (!account) return null;
  // A hand-edited URL can put the dates the wrong way round; read them as the range meant.
  if (from && to && from > to) [from, to] = [to, from];
  const fromDate = from ? fromDateInput(from) : null;
  const toDate = effectiveAsOf(to ? fromDateInput(to) : null);
  // Without an end date, ask for "today" the same way cashBalances() does, so the books are built once per request.
  const h = await accountHistory(code, fromDate, to ? toDate : null);
  let moneyIn = 0;
  let moneyOut = 0;
  const rows = h.rows.map((r, i) => {
    if (r.amount >= 0) moneyIn += r.amount;
    else moneyOut -= r.amount;
    return { key: String(i), date: toDateInput(r.date), label: r.label, href: r.href ?? null, kind: r.kind, amount: r.amount, balance: r.balance };
  });
  return {
    code,
    name: account.name,
    from,
    to: toDateInput(toDate),
    opening: h.opening,
    closing: h.closing,
    moneyIn: round2(moneyIn),
    moneyOut: round2(moneyOut),
    // Newest first, as a bank statement reads on screen; the balance column stays the running balance.
    rows: rows.reverse(),
  };
}

export async function getBankAccount(id: string): Promise<BankAccountDetail | null> {
  await connectDB();
  const d = await BankAccount.findById(id).lean();
  if (!d) return null;
  return {
    id: String(d._id),
    name: d.name,
    kind: d.kind as BankAccountKind,
    bankName: d.bankName ?? null,
    accountLast4: d.accountLast4 ?? null,
    ifsc: d.ifsc ?? null,
    openingBalance: d.openingBalance ?? 0,
    openingDate: toDateInput(d.openingDate),
    defaultFor: (d.defaultFor ?? []).filter(isDefaultFor),
    notes: d.notes ?? null,
    archived: Boolean(d.archivedAt),
  };
}

/** Open accounts for the transfer form. */
export function transferOptions(accounts: AccountRow[]): AccountOption[] {
  return accounts
    .filter((a) => a.id && !a.archived)
    .map((a) => ({
      value: a.id!,
      label: a.name,
      description: [a.kind === "cash" ? "Cash" : a.bankName, a.accountLast4 ? `ending ${a.accountLast4}` : null].filter(Boolean).join(" · "),
      kind: a.kind,
      openingDate: a.openingDate,
    }));
}
