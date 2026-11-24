import type { GroupOption } from "@/features/finance/groups/types";
import type { LiabilityKind } from "@/lib/constants";

/**
 * Which liability groups take records entered on the Liabilities pages. Client-safe, so the forms
 * offer exactly the groups the server accepts.
 *
 * Accounts payable, customer advances, GST and the group company balance are computed from other
 * records (expenses, income, invoices), so nothing is filed under them or their subgroups here.
 */

export const LIABILITY_ROOTS = ["current_liabilities", "non_current_liabilities"] as const;
export type LiabilitySide = (typeof LIABILITY_ROOTS)[number];

/** Built-in groups that hold loans and borrowings. */
export const LOAN_GROUPS = ["short_term_loans", "long_term_bank_loans", "business_loans", "other_long_term_borrowings"];

/** Built-in groups whose records are typed in here (taxes payable also carries the computed GST line). */
export const ENTRY_GROUPS = [
  "short_term_loans",
  "outstanding_expenses",
  "salaries_payable",
  "taxes_payable",
  "other_current_liabilities",
  "long_term_bank_loans",
  "business_loans",
  "other_long_term_borrowings",
];

/** Where each computed line comes from, for the "see where this comes from" links. */
export const COMPUTED_SOURCES: Record<string, { href: string; label: string; note: string }> = {
  accounts_payable: { href: "/finance/liabilities/payables", label: "Accounts payable", note: "Unpaid and part-paid expenses, including older ones saved as On credit." },
  customer_advances: { href: "/finance/income?category=advance", label: "Income: advances", note: "Advances received that are not yet linked to an invoice or a completed project, and anything received above an invoice's total." },
  group_company_payable: {
    href: "/finance/expenses?paymentMethod=biios_startup_llp",
    label: "Expenses paid through Biios Startup LLP",
    note: "Expenses the group company paid on this company's behalf, less what was repaid to it.",
  },
  gst_net: { href: "/finance/invoices", label: "Invoices", note: "GST charged on invoices less GST input credit on expenses." },
};

/** The nearest built-in group at or above a group (a subgroup's built-in parent). */
export function nearestBuiltIn(groups: GroupOption[], key: string): GroupOption | null {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  let g = byKey.get(key);
  for (let i = 0; g && i < 20; i++) {
    if (g.builtIn) return g;
    g = g.parent ? byKey.get(g.parent) : undefined;
  }
  return null;
}

/** The side (current or non-current) a liability group sits on. */
export function sideOf(groups: GroupOption[], key: string): LiabilitySide | null {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  let g = byKey.get(key);
  for (let i = 0; g && i < 20; i++) {
    if (!g.parent) return (LIABILITY_ROOTS as readonly string[]).includes(g.key) ? (g.key as LiabilitySide) : null;
    g = byKey.get(g.parent);
  }
  return null;
}

/**
 * True when records of this kind can be filed under the group. Other obligations go in any group
 * typed in here or a subgroup of one; loans only in the loan groups. A subgroup added straight
 * under Current or Non-current liabilities takes both, since an admin made it for such records.
 */
export function canHoldRecords(groups: GroupOption[], key: string, kind: LiabilityKind): boolean {
  const group = groups.find((g) => g.key === key);
  if (!group || group.kind !== "liability" || group.archived) return false;
  const built = nearestBuiltIn(groups, key);
  if (!built) return false;
  if ((LIABILITY_ROOTS as readonly string[]).includes(built.key)) return !group.builtIn;
  return kind === "loan" ? LOAN_GROUPS.includes(built.key) : ENTRY_GROUPS.includes(built.key);
}

/** Group options for a record form, in tree order, optionally only one side. */
export function recordGroupOptions(groups: GroupOption[], kind: LiabilityKind, side?: LiabilitySide) {
  return groups
    .filter((g) => canHoldRecords(groups, g.key, kind) && (!side || sideOf(groups, g.key) === side))
    .map((g) => ({ value: g.key, label: g.label, description: g.path }));
}

/** Groups a new subgroup can go under on one side: the side itself and every group that takes records. */
export function subgroupParents(groups: GroupOption[], side: LiabilitySide): GroupOption[] {
  return groups.filter((g) => g.key === side || (sideOf(groups, g.key) === side && (canHoldRecords(groups, g.key, "other") || canHoldRecords(groups, g.key, "loan"))));
}
