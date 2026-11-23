import "server-only";

import { cache } from "react";
import { connectDB } from "@/server/db";
import { BankAccount } from "@/server/models";
import type { BankAccountKind } from "@/lib/constants";

/**
 * Bank and cash accounts, and which one a record lands in. A record that names an account uses
 * it; one that does not uses the account set as the default for its payment method; when none is
 * set, the unassigned cash box (cash) or unassigned bank (every other method). Read once per request.
 */

export type CashAccount = {
  /** Ledger code: "cash:<id>", or "cash:unassigned_cash" / "cash:unassigned_bank" when no account is set up. */
  code: string;
  id: string | null;
  name: string;
  kind: BankAccountKind;
  openingBalance: number;
  /** Records dated before this belong to the opening balance; null for the unassigned accounts. */
  openingDate: Date | null;
  defaultFor: string[];
  archived: boolean;
};

export const UNASSIGNED_CASH = "cash:unassigned_cash";
export const UNASSIGNED_BANK = "cash:unassigned_bank";

/** Methods that move money through a bank (everything but cash, the group company and stock). */
export const BANK_METHODS = ["bank_transfer", "upi", "card", "cheque", "credit", "other"] as const;

export type AccountBook = {
  accounts: CashAccount[];
  byCode: Map<string, CashAccount>;
  /** The ledger code for a record's money: its own account, else the default for its method. Null for "stock". */
  resolve: (method: string | null | undefined, accountId?: unknown) => string | null;
};

const unassigned = (kind: BankAccountKind): CashAccount => ({
  code: kind === "cash" ? UNASSIGNED_CASH : UNASSIGNED_BANK,
  id: null,
  name: kind === "cash" ? "Cash (no account set up)" : "Bank (no account set up)",
  kind,
  openingBalance: 0,
  openingDate: null,
  defaultFor: [],
  archived: false,
});

export async function loadAccountBook(): Promise<AccountBook> {
  await connectDB();
  const docs = await BankAccount.find({}).sort({ createdAt: 1 }).lean();
  const accounts: CashAccount[] = docs.map((d) => ({
    code: `cash:${d._id}`,
    id: String(d._id),
    name: d.name,
    kind: d.kind as BankAccountKind,
    openingBalance: d.openingBalance ?? 0,
    openingDate: d.openingDate ?? null,
    defaultFor: d.defaultFor ?? [],
    archived: Boolean(d.archivedAt),
  }));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const byId = new Map(accounts.filter((a) => a.id).map((a) => [a.id!, a]));
  const defaults = new Map<string, CashAccount>();
  for (const a of accounts) for (const m of a.defaultFor) if (!defaults.has(m)) defaults.set(m, a);
  // Without an explicit default, the first cash box takes cash and the first bank account takes the rest.
  const firstCash = accounts.find((a) => a.kind === "cash" && !a.archived);
  const firstBank = accounts.find((a) => a.kind === "bank" && !a.archived);

  const extra: CashAccount[] = [];
  const fallback = (kind: BankAccountKind) => {
    const existing = kind === "cash" ? firstCash : firstBank;
    if (existing) return existing;
    const code = kind === "cash" ? UNASSIGNED_CASH : UNASSIGNED_BANK;
    let a = byCode.get(code);
    if (!a) {
      a = unassigned(kind);
      byCode.set(code, a);
      extra.push(a);
    }
    return a;
  };

  const resolve = (method: string | null | undefined, accountId?: unknown): string | null => {
    if (method === "stock") return null;
    if (method === "biios_startup_llp") return "group_company";
    if (accountId) {
      const own = byId.get(String(accountId));
      if (own) return own.code;
    }
    const m = method ?? "bank_transfer";
    const d = defaults.get(m);
    if (d) return d.code;
    return fallback(m === "cash" ? "cash" : "bank").code;
  };

  return {
    get accounts() {
      return [...accounts, ...extra];
    },
    byCode,
    resolve,
  };
}

/** The account book for this request. */
export const getAccountBook = cache(loadAccountBook);
