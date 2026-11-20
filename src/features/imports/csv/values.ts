/**
 * Reading single CSV cells: dates, amounts, quantities and choices typed by people or exported from
 * spreadsheets and accounting tools. Client-safe and pure. Each reader returns the value, nothing
 * for an empty cell, or a plain-words error.
 */

export type CellResult<T> = { value?: T; error?: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): CellResult<string> {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100) return { error: "The year looks wrong" };
  if (m < 1 || m > 12) return { error: "Not a real date" };
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return { error: "Not a real date" };
  return { value: `${y}-${pad(m)}-${pad(d)}` };
}

/**
 * A calendar day as "yyyy-mm-dd". Accepts 05/11/2026, 5-11-26, 05.11.2026 (day first, as in India),
 * 2026-11-05 (with or without a time after it), 5 Nov 2026, 05-Nov-26, Nov 5, 2026, and Excel day
 * numbers. A month-first date such as 11/25/2026 is refused rather than guessed.
 */
export function parseDateCell(raw: string | undefined): CellResult<string> {
  const s = (raw ?? "").trim();
  if (!s) return {};
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo > 12) return { error: "Use day/month/year, e.g. 25/11/2026" };
    return ymd(y, mo, d);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([a-z]{3,9})\.?[\s\-/.,]+(\d{2}|\d{4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return { error: "Not a date this app can read" };
    return ymd(Number(m[3]), mo, Number(m[1]));
  }
  m = /^([a-z]{3,9})\.?[\s\-/]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/]+(\d{4})$/i.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return { error: "Not a date this app can read" };
    return ymd(Number(m[3]), mo, Number(m[2]));
  }
  // Excel stores days counted from 30 Dec 1899; a date column copied as numbers arrives like that.
  m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const serial = Number(m[1]);
    if (serial >= 32874 && serial <= 73051) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return { error: "Not a date this app can read. Use DD/MM/YYYY" };
}

/**
 * A plain number with optional thousands separators: 1,23,456.50 (Indian), 123,456.50 or 123456.5.
 * Commas in any other place (12,50 or 1.234,56) are refused, so a decimal comma is never read as
 * a thousands separator and an amount never comes out a hundred times too large.
 */
function readNumber(s: string): number | null {
  if (/,/.test(s)) {
    const western = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s);
    const indian = /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/.test(s);
    if (!western && !indian) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** An amount in rupees: "₹1,18,000.00", "Rs. 500", "500/-", "INR 2,000" and "1 180" all read. Never negative. */
export function parseMoneyCell(raw: string | undefined): CellResult<number> {
  let s = (raw ?? "").trim();
  if (!s || s === "-") return {};
  s = s
    .replace(/^(?:₹|rs\.?|inr)\s*/i, "")
    .replace(/\s*(?:₹|rs\.?|inr)$/i, "")
    .replace(/\/-$/, "")
    .replace(/[\s ]/g, "");
  if (/^\(.*\)$/.test(s) || s.startsWith("-")) return { error: "Cannot be negative" };
  if (s.startsWith("+")) s = s.slice(1);
  const n = readNumber(s);
  if (n === null) return { error: "Not an amount. Use digits like 1,18,000.50" };
  return { value: n };
}

/** A quantity or stock level: digits with an optional decimal part. */
export function parseNumberCell(raw: string | undefined): CellResult<number> {
  const s = (raw ?? "").trim().replace(/[\s ]/g, "");
  if (!s) return {};
  if (s.startsWith("-")) return { error: "Cannot be negative" };
  const n = readNumber(s);
  if (n === null) return { error: "Not a number" };
  return { value: n };
}

/** "Bank Transfer", "bank_transfer" and "BANK-TRANSFER" compare equal. */
export function choiceKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Picks an option by value, label or one of the extra names. Returns the option's value, or
 * undefined for an unknown name.
 */
export function matchChoice<T extends string>(
  raw: string,
  options: readonly { value: T; label: string }[],
  aliases: Record<string, T> = {},
): T | undefined {
  const k = choiceKey(raw);
  if (!k) return undefined;
  for (const o of options) if (choiceKey(o.value) === k || choiceKey(o.label) === k) return o.value;
  for (const [name, value] of Object.entries(aliases)) if (choiceKey(name) === k) return value;
  return undefined;
}

/** Other names for payment methods found in bank statements and accounting exports. */
export const PAYMENT_ALIASES: Record<string, string> = {
  bank: "bank_transfer",
  "bank transfer": "bank_transfer",
  neft: "bank_transfer",
  rtgs: "bank_transfer",
  imps: "bank_transfer",
  "net banking": "bank_transfer",
  netbanking: "bank_transfer",
  online: "bank_transfer",
  transfer: "bank_transfer",
  "wire transfer": "bank_transfer",
  gpay: "upi",
  "google pay": "upi",
  phonepe: "upi",
  "phone pe": "upi",
  paytm: "upi",
  bhim: "upi",
  "credit card": "card",
  "debit card": "card",
  "corporate card": "card",
  check: "cheque",
  chq: "cheque",
  dd: "cheque",
  "demand draft": "cheque",
  "pay later": "credit",
  due: "credit",
  unpaid: "credit",
  biios: "biios_startup_llp",
  "biios llp": "biios_startup_llp",
  "biios startup": "biios_startup_llp",
  llp: "biios_startup_llp",
};

/** Other names for inventory units. */
export const UNIT_ALIASES: Record<string, string> = {
  pc: "pcs", piece: "pcs", nos: "pcs", no: "pcs", number: "pcs", numbers: "pcs", unit: "pcs", units: "pcs", ea: "pcs", each: "pcs",
  sets: "set", boxes: "box", bx: "box",
  kgs: "kg", kilo: "kg", kilogram: "kg",
  gm: "g", gms: "g", gram: "g", grams: "g",
  mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m",
  foot: "ft", feet: "ft",
  ltr: "l", ltrs: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  rolls: "roll", sheets: "sheet", pairs: "pair", pr: "pair",
};

/** Names compared for duplicates and lookups: trimmed, spaces collapsed, case ignored. */
export function looseKey(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
