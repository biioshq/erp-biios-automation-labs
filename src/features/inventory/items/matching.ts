/**
 * Name matching for "is this item already in inventory?". Client-safe and pure,
 * so the Add item form and the item actions agree on what counts as the same item.
 */

/** Trimmed, lower case, runs of spaces collapsed: "  Steel   RODS " and "steel rods" are the same name. */
export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Letters and digits only: "Wi-Fi Switch" and "wifi switch" compare equal. A decimal point between
 * two digits is kept (as "d"), so "1.5 sq mm" and "15 sq mm" stay different sizes.
 */
function compact(name: string): string {
  return normalizeItemName(name)
    .replace(/(\d)\.(?=\d)/g, "$1d")
    .replace(/[^a-z0-9]/g, "");
}

/** The words of a name as a sorted set: "Rods steel" and "Steel rods" compare equal. */
function wordSet(name: string): string {
  const words = normalizeItemName(name)
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
  return [...new Set(words)].sort().join(" ");
}

export type NameMatch = "exact" | "similar";

/**
 * How `typed` relates to an existing item name: "exact" (same after trimming, case and spaces),
 * "similar" (same letters and digits, or the same words in another order), or null.
 */
export function matchItemName(typed: string, existing: string): NameMatch | null {
  const a = normalizeItemName(typed);
  const b = normalizeItemName(existing);
  if (!a || !b) return null;
  if (a === b) return "exact";
  const ca = compact(a);
  // Very short names ("A", "12") would match too much once punctuation is stripped.
  if (ca.length >= 3 && ca === compact(b)) return "similar";
  const wa = wordSet(a);
  if (wa && wa.includes(" ") && wa === wordSet(b)) return "similar";
  return null;
}

/** SKUs are stored in upper case; the form upper-cases too, but a pasted value may still have spaces. */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** A regular expression matching `name` exactly, ignoring case, surrounding spaces and repeated spaces. */
export function exactNamePattern(name: string): RegExp {
  const words = normalizeItemName(name)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${words.join("\\s+")}\\s*$`, "i");
}

/** "Steel rods (copy 2)" -> "Steel rods": the name a copy is made from, without an earlier copy suffix. */
export function copyBaseName(name: string): string {
  return name.trim().replace(/\s+/g, " ").replace(/\s*\(copy(?:\s+\d+)?\)$/i, "").trim() || name.trim();
}

/** Which copy a name is: 0 for "Steel rods", 1 for "Steel rods (copy)", 3 for "Steel rods (copy 3)". */
export function copyNumber(name: string): number {
  const m = /\(copy(?:\s+(\d+))?\)\s*$/i.exec(name);
  return m ? (m[1] ? Number(m[1]) : 1) : 0;
}

/** The nth copy name of `base`: "<base> (copy)", then "<base> (copy 2)", "(copy 3)" and so on, within `max` characters. */
export function copyName(base: string, n: number, max = 160): string {
  const suffix = n <= 1 ? " (copy)" : ` (copy ${n})`;
  return `${base.slice(0, Math.max(1, max - suffix.length)).trim()}${suffix}`;
}

/** A regular expression for names that start with `name` (same spacing rules as exactNamePattern). */
export function namePrefixPattern(name: string): RegExp {
  const words = normalizeItemName(name)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${words.join("\\s+")}`, "i");
}
