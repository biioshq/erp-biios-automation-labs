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
  { value: "vendor", label: "Vendor / beneficiary / payer" },
  { value: "category", label: "Category" },
];

/** The header rows are looked for in the first rows only; bank statements start with a few lines about the account. */
const HEADER_SEARCH_ROWS = 60;

export const headerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const OUT_WORD = "withdraw|debit|(^| )dr( |$)|paid out|money out";
const IN_WORD = "deposit|credit|(^| )cr( |$)|paid in|money in";
const BOTH_SIDES = new RegExp(`(${OUT_WORD}).*(${IN_WORD})|(${IN_WORD}).*(${OUT_WORD})`);

/** What a column name means, or null for columns the statement reader does not use (serial number, branch). */
export function roleOf(header: string): ColumnRole | null {
  const k = headerKey(header);
  if (!k) return null;
  if (/^(s|sl|sr|serial)( no| number)?$|^no$/.test(k)) return null;
  if (/(^| )(dr|debit) ?(cr|credit)( |$)|(^| )(cr|credit) ?(dr|debit)( |$)|^(txn |transaction |tran )?type$|^d c$|^c d$/.test(k)) return "drcr";
  if (/(^| )(balance|bal)( |$)/.test(k)) return "balance";
  if (/value (date|dt)/.test(k)) return "valueDate";
  if (/(^| )(date|dt)( |$)/.test(k)) return "date";
  // One column named for both sides (Kotak "Withdrawal (Dr)/ Deposit (Cr)") holds every amount; a
  // Dr / Cr column or mark beside it tells the side.
  if (BOTH_SIDES.test(k)) return "amount";
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
function baseMapping(headers: string[]): (ColumnRole | null)[] {
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

/** Words around a name that make the column a number or a bank, not the party ("Beneficiary Account No", "Payee IFSC"). */
const NOT_A_NAME = /(^| )(account|acct|a c|ac|ifsc|bank|branch|no|number|id|code|vpa|upi|mobile|phone|email|address|type)( |$)/;

/**
 * The optional columns some files carry: the vendor, beneficiary or payer, and a category. Only
 * looked at for columns the reader does not use otherwise, so finding the header row, reading a
 * PDF's columns and every line's hash stay exactly as they were.
 */
export function optionalRoleOf(header: string): "vendor" | "category" | null {
  const k = headerKey(header);
  if (!k) return null;
  if (/(^| )categor(y|ies)( |$)|^(expense|income|ledger) head$|^head$|^tags?$/.test(k)) return "category";
  if (NOT_A_NAME.test(k)) return null;
  if (/(^| )(beneficiary|payee|payer|party|remitter|counterparty|counter party|vendor|supplier|merchant)( |$)|^name$|^(paid to|received from)$/.test(k)) return "vendor";
  return null;
}

/**
 * The role of every column: the columns a statement is read with (see baseMapping), then the
 * optional vendor and category columns among the ones left over, the first of each.
 */
export function autoMapping(headers: string[]): (ColumnRole | null)[] {
  const out = baseMapping(headers);
  const used = new Set<ColumnRole>();
  headers.forEach((h, i) => {
    if (out[i] !== null) return;
    const role = optionalRoleOf(h);
    if (!role || used.has(role)) return;
    used.add(role);
    out[i] = role;
  });
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

/** How the amounts are laid out, in plain words, for the mapping step. Null until the amount columns are picked. */
export function amountLayout(mapping: (ColumnRole | null)[]): string | null {
  const has = (r: ColumnRole) => mapping.includes(r);
  if (has("withdrawal") && has("deposit")) return "Separate withdrawal and deposit columns";
  if (has("amount")) return has("drcr") ? "One amount column with Dr/Cr" : "One amount column with signs";
  if (has("withdrawal")) return "Only a withdrawal column: its sign tells the side";
  if (has("deposit")) return "Only a deposit column: its sign tells the side";
  return null;
}

/** How well a row reads as the column names: the roles found, and whether it is enough to read lines. */
export function headerScore(cells: string[]): { score: number; usable: boolean } {
  // The optional vendor and category columns never count here, so the header row found stays the same.
  const mapping = baseMapping(cells);
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

/** Column names only one bank's export uses together, for files with no bank name above the table. */
const HEADER_SIGNATURES: [RegExp[], string][] = [
  [[/^transaction remarks$/, /^withdrawal amount inr$/, /^deposit amount inr$/], "ICICI Bank"],
  [[/^narration$/, /^chq ref no$/, /^value dt$/, /^closing balance$/], "HDFC Bank"],
  [[/^txn date$/, /^ref no cheque no$/], "State Bank of India"],
  [[/^tran date$/, /^chqno$/, /^particulars$/], "Axis Bank"],
];

/**
 * The bank whose statement this is, from the lines above the column names (never the
 * transactions: a narration often names another bank), else from the column names themselves.
 */
export function detectBank(grid: GridRow[], headerIndex: number): string | null {
  const top = grid
    .slice(0, headerIndex >= 0 ? headerIndex : 15)
    .flatMap((r) => r.cells)
    .join(" ");
  for (const [re, name] of BANKS) if (re.test(top)) return name;
  if (headerIndex < 0) return null;
  const names = (grid[headerIndex]?.cells ?? []).map(headerKey);
  for (const [sig, name] of HEADER_SIGNATURES) if (sig.every((re) => names.some((n) => re.test(n)))) return name;
  return null;
}
