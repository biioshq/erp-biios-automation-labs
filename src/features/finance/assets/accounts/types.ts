import type { BankAccountKind } from "@/lib/constants";
import type { DefaultForMethod } from "./schemas";

/** Cash and bank page data. Client-safe: plain values only. */

export type AccountRow = {
  /** Ledger code ("cash:<id>", or one of the "no account set up" codes). */
  code: string;
  /** Null for the fallback accounts that exist only because records name no account. */
  id: string | null;
  name: string;
  kind: BankAccountKind;
  archived: boolean;
  /** Balance as of today, from the accounting engine. */
  balance: number;
  openingBalance: number;
  /** "yyyy-mm-dd"; null for the fallback accounts. */
  openingDate: string | null;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  defaultFor: DefaultForMethod[];
  notes: string | null;
};

/** Where records of a payment method that name no account land, and why. */
export type MethodRoute = {
  method: DefaultForMethod;
  label: string;
  accountName: string;
  reason: "default" | "first_of_kind" | "not_set_up";
};

export type CashOverview = {
  asOf: string;
  accounts: AccountRow[];
  cashInHand: number;
  bankBalance: number;
  total: number;
  /** True when no bank or cash account has been added yet. */
  noAccounts: boolean;
  /** True when the fallback accounts hold money: some records land in "no account set up". */
  usesFallback: boolean;
  routes: MethodRoute[];
};

export type TransferRow = {
  id: string;
  date: string;
  amount: number;
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  reference: string | null;
  notes: string | null;
  /** Came from a bank statement line (can't be deleted here). */
  fromStatement: boolean;
  /** The statement lines tied to it: one per account whose statement shows it, so at most two. */
  bankTransactionIds: string[];
};

export type HistoryRow = {
  /** Stable key for the table: posting order. */
  key: string;
  date: string;
  label: string;
  href: string | null;
  kind: string;
  /** Money in is positive, money out negative. */
  amount: number;
  balance: number;
};

export type AccountHistory = {
  code: string;
  name: string;
  from: string | null;
  to: string;
  opening: number;
  closing: number;
  moneyIn: number;
  moneyOut: number;
  rows: HistoryRow[];
};

export type BankAccountDetail = {
  id: string;
  name: string;
  kind: BankAccountKind;
  bankName: string | null;
  accountLast4: string | null;
  ifsc: string | null;
  openingBalance: number;
  openingDate: string;
  defaultFor: DefaultForMethod[];
  notes: string | null;
  archived: boolean;
};

export type AccountOption = {
  value: string;
  label: string;
  description: string;
  kind: BankAccountKind;
  /** "yyyy-mm-dd": a transfer dated earlier is already inside this account's opening balance. */
  openingDate: string | null;
};
