/**
 * Direct or indirect: direct costs go into delivering projects, indirect ones are overheads.
 * Client-safe. An expense booked to a project is direct whatever its category; otherwise its
 * category decides (admins can set it per category; these are the defaults for the built-ins).
 */

import type { ExpenseNature } from "./constants";

const DIRECT_BUILT_INS = new Set(["materials", "inventory", "equipment", "labour", "contractors", "logistics"]);

/** The default nature of a category; custom categories default to indirect. */
export function defaultNature(category: string): ExpenseNature {
  return DIRECT_BUILT_INS.has(category) ? "direct" : "indirect";
}

/** Nature of one expense. `categoryNature` is the admin's setting for its category, if any. */
export function expenseNature(e: { category: string; project?: unknown }, categoryNature?: ExpenseNature | null): ExpenseNature {
  if (e.project) return "direct";
  return categoryNature ?? defaultNature(e.category);
}
