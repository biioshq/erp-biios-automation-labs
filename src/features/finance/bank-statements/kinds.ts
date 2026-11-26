/**
 * The type of a statement line in plain words (deposit, withdrawal, transfer, bank charges...),
 * from what the narration says and what the line becomes. Client-safe and pure: the review shows
 * it as the action changes, and the add stores it on the line (BankTransaction.kind). It never
 * feeds the line's hash.
 */

import type { BankLineAction } from "@/lib/constants";
import type { LineKind } from "./parse/narration";

export const BANK_LINE_KINDS = [
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "transfer", label: "Transfer" },
  { value: "bank_charges", label: "Bank charges" },
  { value: "interest", label: "Interest" },
  { value: "loan", label: "Loan" },
  { value: "atm_cash", label: "ATM / cash" },
  { value: "refund", label: "Refund" },
  { value: "salary", label: "Salary" },
  { value: "tax", label: "Tax" },
] as const;

export type BankLineKind = (typeof BANK_LINE_KINDS)[number]["value"];

export const BANK_LINE_KIND_VALUES = BANK_LINE_KINDS.map((k) => k.value) as [BankLineKind, ...BankLineKind[]];

const FROM_NARRATION: Record<Exclude<LineKind, null>, BankLineKind> = {
  charges: "bank_charges",
  interest: "interest",
  atm: "atm_cash",
  loan: "loan",
  refund: "refund",
  salary: "salary",
  tax: "tax",
};

/**
 * The line's type. The chosen action wins where it says more (a transfer, a loan); otherwise the
 * narration's kind; otherwise the side of the statement it is on.
 */
export function lineKindOf(side: "dr" | "cr", narrationKind: LineKind, action: BankLineAction | null): BankLineKind {
  if (action === "transfer") return narrationKind === "atm" ? "atm_cash" : "transfer";
  if (action === "loan_received" || action === "loan_payment") return "loan";
  if (narrationKind) return FROM_NARRATION[narrationKind];
  return side === "dr" ? "withdrawal" : "deposit";
}

export function lineKindLabel(kind: BankLineKind): string {
  return BANK_LINE_KINDS.find((k) => k.value === kind)?.label ?? kind;
}
