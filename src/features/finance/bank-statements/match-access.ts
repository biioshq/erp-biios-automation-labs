import type { MatchKind } from "./types";

/**
 * "Already recorded" ties a line to a record of another page, which then keeps its amount and account
 * and cannot be deleted until the line is unmatched. So each kind needs the permission to change that
 * record on its own page; paying a bill needs the bill payments permission, as on Payment tracking.
 * A transfer is joined with the permission that records one, as the line's Transfer action does.
 * Client-safe: the add action checks it, and the review offers only the kinds the person may use.
 */
export const MATCH_PERMISSIONS: Record<MatchKind, { permission: string; what: string }> = {
  expense: { permission: "finance.expenses:edit", what: "lines tied to recorded expenses" },
  expensePayment: { permission: "finance.expenses:edit", what: "lines tied to recorded expenses" },
  bill: { permission: "finance.payments:create", what: "bill payments" },
  income: { permission: "finance.income:edit", what: "lines tied to recorded income" },
  capitalEntry: { permission: "finance.equity:edit", what: "lines tied to capital entries" },
  liability: { permission: "finance.liabilities:edit", what: "lines tied to loans" },
  liabilityPayment: { permission: "finance.liabilities:edit", what: "lines tied to loans" },
  accountTransfer: { permission: "finance.cash_bank:create", what: "lines tied to transfers" },
};

/** The kind named by a match key ("expense:<id>"), or null when it names none. */
export function matchKindOf(matchKey: string | null | undefined): MatchKind | null {
  const kind = (matchKey ?? "").split(":")[0] ?? "";
  return Object.prototype.hasOwnProperty.call(MATCH_PERMISSIONS, kind) ? (kind as MatchKind) : null;
}
