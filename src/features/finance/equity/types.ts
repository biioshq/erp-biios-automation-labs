import type { FileDTO } from "@/features/files/types";
import type { CapitalEntryType, EquityHolderKind, InvestorInstrument, PaymentMethod } from "@/lib/constants";

/** An owner or investor with their totals (from equityOverview, so they match the balance sheet). */
export type HolderRow = {
  id: string;
  name: string;
  kind: EquityHolderKind;
  ownershipPercent: number | null;
  instrument: InvestorInstrument | null;
  archived: boolean;
  /** All capital introduced. */
  capital: number;
  initial: number;
  additional: number;
  drawings: number;
  dividends: number;
  /** Capital less drawings. */
  net: number;
  firstContribution: string | null;
  lastContribution: string | null;
  entries: number;
};

export type HolderDetail = HolderRow & {
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  history: EntryRow[];
};

/** For pickers in the entry forms. */
export type HolderOption = {
  value: string;
  label: string;
  kind: EquityHolderKind;
  instrument: InvestorInstrument | null;
  archived: boolean;
};

export type EntryRow = {
  id: string;
  number: string;
  type: CapitalEntryType;
  date: string;
  amount: number;
  holder: { id: string; name: string; kind: EquityHolderKind } | null;
  initial: boolean | null;
  instrument: InvestorInstrument | null;
  reserveGroup: { key: string; label: string } | null;
  paymentMethod: PaymentMethod | null;
  account: { id: string; name: string } | null;
  reference: string | null;
  purpose: string | null;
  documents: number;
};

export type EntryDetail = EntryRow & {
  notes: string | null;
  files: FileDTO[];
  fromBankStatement: boolean;
  /** The statement line it came from or was matched to (/finance/bank-statements?line=<id>). */
  bankTransactionId: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** One financial year of the retained earnings roll-forward. */
export type RetainedYear = {
  label: string;
  from: string;
  to: string;
  opening: number;
  profit: number;
  /** Retained earnings figures entered inside this year (corrections to the opening figure). */
  adjustments: number;
  dividends: number;
  toReserves: number;
  closing: number;
  current: boolean;
};

export type ReserveRow = {
  key: string;
  label: string;
  parent: string | null;
  depth: number;
  builtIn: boolean;
  description: string | null;
  /** Balance from the ledger (credit positive). */
  balance: number;
  transfers: number;
};
