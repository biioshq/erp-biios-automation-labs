/**
 * Reading the cells of a bank statement: dates, amounts with Dr / Cr marks, and balances.
 * Client-safe and pure.
 */

import { parseDateCell } from "@/features/imports/csv/values";

export type Side = "dr" | "cr";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * A statement date as yyyy-mm-dd. Takes what the import reader takes (05/11/2026, 05-11-26,
 * 05 Nov 2026, 05-Nov-26, 2026-11-05, Excel day numbers) and also a time after the date.
 */
export function readDate(raw: string | undefined): string | null {
  const s = (raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    // "05/11/2026 10:42:11", "05 Nov 2026 10:42 AM"
    .replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([ap]\.?m\.?)?(\s*(ist|z|[+-]\d{2}:?\d{2}))?$/i, "")
    .replace(/,$/, "");
  if (!s) return null;
  return parseDateCell(s).value ?? null;
}

/** A side written in a Dr / Cr column: "Dr", "D", "Debit", "W" or "Cr", "C", "Credit". */
export function readSide(raw: string | undefined): Side | null {
  const k = (raw ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return null;
  if (/^(dr|d|debit|db|w|wd|wdl|withdrawal)$/.test(k)) return "dr";
  if (/^(cr|c|credit|dep|deposit)$/.test(k)) return "cr";
  return null;
}

export type AmountCell = { value: number; side: Side | null; negative: boolean };

/**
 * An amount: "1,18,000.50", "₹ 500", "Rs.500", "INR 2,000", "500.00 Dr", "500.00(Cr)", "-500",
 * "(500)" and "500-". Returns null for an empty cell and "invalid" for text that is not an amount.
 */
export function readAmount(raw: string | undefined): AmountCell | null | "invalid" {
  let s = (raw ?? "").trim();
  if (!s || /^[-\u2013\u2014.]+$/.test(s) || /^(nil|na|n\/a)$/i.test(s)) return null;
  let side: Side | null = null;
  const mark = /\(?(dr|cr)\.?\)?\s*$/i.exec(s) ?? /^\(?(dr|cr)\.?\)?\s*/i.exec(s);
  if (mark) {
    side = mark[1]!.toLowerCase() === "dr" ? "dr" : "cr";
    s = s.replace(mark[0], "").trim();
  }
  s = s.replace(/₹|\brs\.?|\binr\b/gi, "").replace(/[\s ]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith("-") && !s.endsWith("/-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/\/-$/, "").replace(/^\+/, "");
  // Banks print well-formed thousands separators (1,23,456.78 or 123,456.78). Anything else ("12,50",
  // a decimal comma) is not an amount, so it is never read a hundred times too large.
  if (/,/.test(s)) {
    const western = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s);
    const indian = /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/.test(s);
    if (!western && !indian) return "invalid";
    s = s.replace(/,/g, "");
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return "invalid";
  const n = Number(s);
  if (!Number.isFinite(n)) return "invalid";
  return { value: round2(n), side, negative };
}

/** A balance; "Dr" (or a minus) is an overdraft, read as negative. */
export function readBalance(raw: string | undefined, sideCell?: string): number | null | "invalid" {
  const a = readAmount(raw);
  if (a === null || a === "invalid") return a;
  const side = a.side ?? readSide(sideCell);
  return a.negative || side === "dr" ? -a.value : a.value;
}
