import "server-only";

import type { AccountBook } from "@/server/accounts";
import type { ExpenseSource } from "@/lib/constants";

/**
 * Where a record's money is in the books: this account, another one (when it named none), or nowhere
 * near. The review offers a record only when `ok`, and adding a line checks the same, so a record the
 * review would not offer cannot be tied to the line by a crafted request.
 */
export function placement(book: AccountBook, target: string, method: string | null | undefined, account: unknown): { ok: boolean; other?: string } {
  const code = book.resolve(method ?? "bank_transfer", account);
  if (code === target) return { ok: true };
  if (account || !code?.startsWith("cash:") || method === "cash" || method === "credit" || method === "stock" || method === "biios_startup_llp") return { ok: false };
  return { ok: true, other: book.byCode.get(code)?.name ?? "another account" };
}

/** Expenses that are never a bank line of their own: stock moves, and loan interest (part of its repayment). */
export const UNMATCHED_EXPENSE_SOURCES: ExpenseSource[] = ["inventory_assignment", "inventory_wastage", "liability_interest"];
