/**
 * Finding the column names of a bank statement and what each column holds. Client-safe and pure,
 * so the page can re-read the file's rows when the admin picks another header row or column.
 *
 * Indian banks name the same columns many ways: HDFC "Narration, Chq./Ref.No., Value Dt,
 * Withdrawal Amt., Deposit Amt., Closing Balance"; ICICI "Transaction Remarks, Withdrawal Amount
 * (INR ), Deposit Amount (INR ), Balance (INR )"; SBI "Txn Date, Description, Ref No./Cheque No.,
 * Debit, Credit, Balance"; Axis "Tran Date, CHQNO, PARTICULARS, DR, CR, BAL"; Kotak "Amount, Dr / Cr,
 * Balance, Dr / Cr"; Yes "Withdrawals, Deposits, Running Balance"; IDFC "Particulars, Debit, Credit".
 */

import type { ColumnRole, GridRow } from "../types";

export const COLUMN_ROLES: { value: ColumnRole; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "valueDate", label: "Value date" },
  { value: "narration", label: "Narration" },
  { value: "reference", label: "Cheque / reference" },
  { value: "withdrawal", label: "Withdrawal (debit)" },
  { value: "deposit", label: "Deposit (credit)" },
  { value: "amount", label: "Amount (one column)" },
  { value: "drcr", label: "Dr / Cr of the amount" },
  { value: "balance", label: "Balance" },
  { value: "balanceSide", label: "Dr / Cr of the balance" },
];

/** The header rows are looked for in the first rows only; bank statements start with a few lines about the account. */
const HEADER_SEARCH_ROWS = 60;

export const headerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** What a column name means, or null for columns the statement reader does not use (serial number, branch). */
export function roleOf(header: string): ColumnRole | null {
  const k = headerKey(header);
  if (!k) return null;
  if (/^(s|sl|sr|serial)( no| number)?$|^no$/.test(k)) return null;
  if (/(^| )(dr|debit) ?(cr|credit)( |$)|(^| )(cr|credit) ?(dr|debit)( |$)|^(txn |transaction |tran )?type$|^d c$|^c d$/.test(k)) return "drcr";
  if (/(^| )(balance|bal)( |$)/.test(k)) return "balance";
  if (/value (date|dt)/.test(k)) return "valueDate";
  if (/(^| )(date|dt)( |$)/.test(k)) return "date";
  if (/withdraw|debit|(^| )dr( |$)|paid out|money out/.test(k)) return "withdrawal";
  if (/deposit|credit|(^| )cr( |$)|paid in|money in/.test(k)) return "deposit";
  if (/narration|description|particular|remark|details|transaction info/.test(k)) return "narration";
  if (/chq|cheque|check|(^| )ref|utr|instrument|(transaction|txn|tran) (id|no|number)/.test(k)) return "reference";
  if (/amount|(^| )amt( |$)/.test(k)) return "amount";
  return null;
}

/**
 * The role of every column. A role is given once (the first column wins), except that a Dr / Cr
 * column right after the balance is the balance's side (Kotak prints one after each).
 */
export function autoMapping(headers: string[]): (ColumnRole | null)[] {
  const used = new Set<ColumnRole>();
  const out: (ColumnRole | null)[] = [];
  headers.forEach((h, i) => {
    let role = roleOf(h);
    if (role === "drcr" && out[i - 1] === "balance") role = "balanceSide";
    if (role && used.has(role)) {
      // "Transaction Date" and "Txn Posted Date": the first is the date.
      out.push(null);
      return;
    }
    if (role) used.add(role);
    out.push(role);
  });
  // A single amount column next to separate withdrawal and deposit columns is a duplicate.
  if (used.has("amount") && (used.has("withdrawal") || used.has("deposit"))) {
    const i = out.indexOf("amount");
    if (i >= 0) out[i] = null;
  }
  // A Dr / Cr column without a single amount column has nothing to say.
  if (used.has("drcr") && !used.has("amount")) {
    const i = out.indexOf("drcr");
    if (i >= 0) out[i] = null;
  }
  return out;
}

/** Problems that stop the lines being read with this mapping, in plain words. */
export function mappingProblems(mapping: (ColumnRole | null)[]): string[] {
  const has = (r: ColumnRole) => mapping.includes(r);
  const problems: string[] = [];
  if (!has("date") && !has("valueDate")) problems.push("Pick the column with the transaction date.");
  if (!has("withdrawal") && !has("deposit") && !has("amount")) problems.push("Pick the withdrawal and deposit columns, or the amount column.");
  if (!has("narration") && !has("reference")) problems.push("Pick the narration (description) column.");
  return problems;
}

/** How well a row reads as the column names: the roles found, and whether it is enough to read lines. */
export function headerScore(cells: string[]): { score: number; usable: boolean } {
  const mapping = autoMapping(cells);
  const roles = new Set(mapping.filter((r): r is ColumnRole => Boolean(r)));
  return { score: roles.size, usable: roles.size >= 3 && mappingProblems(mapping).length === 0 };
}

/** True for a row that repeats the column names (PDF pages repeat them). */
export function isHeaderLike(cells: string[]): boolean {
  return headerScore(cells).usable;
}

/** The first row in the top of the file that names enough columns to read transactions, or -1. */
export function findHeaderRow(grid: GridRow[]): number {
  const limit = Math.min(grid.length, HEADER_SEARCH_ROWS);
  for (let i = 0; i < limit; i++) if (headerScore(grid[i]!.cells).usable) return i;
  return -1;
}

const BANKS: [RegExp, string][] = [
  [/\bhdfc\b/i, "HDFC Bank"],
  [/\bicici\b/i, "ICICI Bank"],
  [/state bank of india|\bsbi\b/i, "State Bank of India"],
  [/\baxis\b/i, "Axis Bank"],
  [/\bkotak\b/i, "Kotak Mahindra Bank"],
  [/\byes bank\b/i, "Yes Bank"],
  [/\bidfc\b/i, "IDFC First Bank"],
  [/bank of baroda/i, "Bank of Baroda"],
  [/punjab national/i, "Punjab National Bank"],
  [/canara bank/i, "Canara Bank"],
  [/union bank/i, "Union Bank of India"],
  [/indusind/i, "IndusInd Bank"],
  [/federal bank/i, "Federal Bank"],
];

/** The bank whose statement this is, from the lines above the column names. */
export function detectBank(grid: GridRow[], headerIndex: number): string | null {
  const top = grid.slice(0, Math.max(headerIndex, 0) || 15).flatMap((r) => r.cells).join(" ");
  for (const [re, name] of BANKS) if (re.test(top)) return name;
  return null;
}
