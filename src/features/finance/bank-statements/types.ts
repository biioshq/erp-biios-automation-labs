/**
 * Shapes shared by the statement reader (API route), the review and the add action, and the page.
 * Client-safe: no server imports.
 */

import type { BankLineAction, IncomeCategory, ProjectStage } from "@/lib/constants";
import type { LineKind } from "./parse/narration";
import type { BankLineKind } from "./kinds";

/** Payment methods a statement line can carry (see STATEMENT_METHODS). */
export type StatementMethod = "bank_transfer" | "upi" | "card" | "cheque" | "cash" | "other";

/** One row of the uploaded file, as text cells. `near` is false for a PDF row far below the one before it. */
export type GridRow = { line: number; cells: string[]; page?: number; near?: boolean };

export type StatementFormat = "csv" | "xlsx" | "xls" | "pdf";

/** What a column of the statement holds. */
export type ColumnRole =
  | "date"
  | "valueDate"
  | "narration"
  | "reference"
  | "withdrawal"
  | "deposit"
  | "amount"
  | "drcr"
  | "balance"
  | "balanceSide"
  /** Optional: the vendor, beneficiary or payer, when the file has its own column for it. */
  | "vendor"
  /** Optional: the file's own expense or income category. */
  | "category";

/** The API route's answer: the file's rows and the columns it found. */
export type ReadStatementResult = {
  fileName: string;
  format: StatementFormat;
  /** Every non-empty row of the file (or of the PDF's pages), header row included. */
  grid: GridRow[];
  /** Index into `grid` of the column names, or -1 when none was found. */
  headerIndex: number;
  mapping: (ColumnRole | null)[];
  /** The bank named at the top of the statement, when one is recognised. */
  bank: string | null;
  sheet?: string;
  notes: string[];
};

/** How a line's side was confirmed against the running balance. */
export type BalanceCheck = "ok" | "fixed" | "mismatch" | "unchecked";

/** One transaction read from the statement. Amounts in rupees, rounded to paise. */
export type StatementLine = {
  /** Row number in the file (PDF: running row number), for the CSV of lines not added. */
  line: number;
  page?: number;
  /** yyyy-mm-dd (IST calendar day). */
  date: string;
  valueDate?: string;
  narration: string;
  reference?: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  check: BalanceCheck;
  issues: string[];
  /** From a mapped vendor column: the line's party, ahead of the name read from the narration. Not part of the hash. */
  vendor?: string;
  /** From a mapped category column, as written in the file. Not part of the hash. */
  category?: string;
};

export type ParsedStatement = {
  lines: StatementLine[];
  /** Rows with an amount that could not be read as a transaction. */
  skipped: { line: number; reason: string }[];
  from: string | null;
  to: string | null;
  opening: number | null;
  closing: number | null;
  /** True when the opening balance came from an "Opening balance" row, not from the first line. */
  openingStated: boolean;
  totalDeposits: number;
  totalWithdrawals: number;
  /** The file listed the newest line first; the lines here are oldest first. */
  newestFirst: boolean;
  fixed: number;
  mismatches: number;
  /** Lines whose side could only be taken from the sign or column, without a balance to confirm it. */
  unchecked: number;
};

/** A record the line may already be. `key` is "<kind>:<id>". */
export type MatchKind = "expense" | "expensePayment" | "bill" | "income" | "capitalEntry" | "liability" | "liabilityPayment" | "accountTransfer";

export type MatchOption = {
  key: string;
  kind: MatchKind;
  id: string;
  /** The expense or loan a payment belongs to. */
  parentId?: string;
  label: string;
  detail: string;
  href: string;
  amount: number;
  date: string;
  score: number;
  /** Set when the record's money is counted in another account than the statement's. */
  otherAccount?: string;
};

/** What the admin decided for one line. Sent to the add action as is. */
export type LineDecision = {
  action: BankLineAction;
  /** match: the record ("<kind>:<id>"). */
  matchKey?: string;
  /** Vendor (expense), client (income), lender (loan received). */
  party?: string;
  category?: string;
  incomeCategory?: IncomeCategory;
  projectId?: string;
  stage?: ProjectStage;
  paymentMethod: StatementMethod;
  description?: string;
  /** transfer: the other own account. */
  otherAccountId?: string;
  /** loan_payment */
  loanId?: string;
  principal?: number;
  interest?: number;
  /** loan_received */
  loanName?: string;
  loanGroup?: string;
  /** capital / drawing */
  holderId?: string;
  /**
   * income: the open customer invoice this receipt pays. The new income is linked to it when the
   * invoice receipt rules allow (checked again on the server); otherwise it is added unlinked.
   */
  invoiceId?: string;
};

export type ImportedInfo = {
  action: BankLineAction;
  on: string;
  label: string | null;
  href: string | null;
};

/** A statement line after the server looked at it: what it may be and what it suggests. */
export type ReviewLine = StatementLine & {
  hash: string;
  /** Identical lines before this one in the statement (see lineHash). */
  occurrence: number;
  /** Already imported from an earlier upload: nothing is added for it. */
  imported: ImportedInfo | null;
  candidates: MatchOption[];
  suggestion: LineDecision;
  notes: string[];
  attention: boolean;
  /**
   * Why "Add all lines" leaves this line for a person (it may already be in the books, or its amount
   * does not agree with the balance). Ticking it by hand still adds it.
   */
  holdBack?: string | null;
  /** What the narration says the line is (charges, interest, ATM...), for the line's type in the review. */
  narrationKind?: LineKind;
  /** A deposit that pays an open customer invoice: the invoice, so the review can link the receipt to it or not. */
  invoice?: { id: string; number: string; client: string; outstanding: number } | null;
};

export type Picker = { value: string; label: string; description?: string };

/** Everything the review screen needs to choose from. */
export type StatementPickers = {
  accounts: (Picker & { kind: "bank" | "cash" })[];
  projects: (Picker & { status: string })[];
  categories: Picker[];
  holders: (Picker & { kind: string })[];
  loans: (Picker & { outstanding: number | null })[];
  liabilityGroups: Picker[];
};

export type AddLineResult = {
  hash: string;
  line: number;
  status: "added" | "matched" | "ignored" | "already" | "failed";
  message: string;
  label?: string | null;
  href?: string | null;
  /** The record the line became or was tied to, for follow-up links on the results screen. */
  recordKind?: string | null;
  recordId?: string | null;
  /** A follow-up worth saying, such as the invoice a receipt was linked to, or why it was not. */
  note?: string | null;
};

export type AddBatchResult = { statementId: string | null; results: AddLineResult[] };

/** A past upload, for the list. */
export type StatementRow = {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string | null;
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  lines: number;
  added: number;
  matched: number;
  ignored: number;
  createdAt: string;
  createdBy: string | null;
};

/**
 * Where a stored line stands: tied to a record, tied to a record deleted since, back to needing
 * review (unmatched, or an add cut off long ago), ignored, or being added right now.
 */
export type StoredLineState = "linked" | "deleted" | "review" | "ignored" | "adding";

export type StoredLine = {
  id: string;
  state: StoredLineState;
  date: string;
  narration: string;
  reference: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  action: BankLineAction;
  label: string | null;
  href: string | null;
  /** When an admin unmatched the line from its record, and who (null when the user was removed since). */
  unmatchedAt: string | null;
  unmatchedBy: string | null;
  /** The line's type and its row in the uploaded file, on lines added since they are stored. */
  kind?: BankLineKind | null;
  row?: number | null;
};

/** A remembered party, for the Remembered parties list. */
export type PartyRuleRow = {
  id: string;
  /** "out": a payee of withdrawals (a vendor); "in": a payer of deposits (a client). */
  side: "in" | "out";
  /** The name (or UPI handle) as the statement shows it. */
  key: string;
  token: string | null;
  party: string;
  category: string | null;
  categoryLabel: string | null;
  projectId: string | null;
  projectName: string | null;
  stage: ProjectStage | null;
  hits: number;
  lastUsedAt: string | null;
};

export type UnmatchResult ={ status: "unmatched" | "already"; message: string };

/** A stored line reviewed again on its statement's page, to be added again. */
export type StoredLineReview = { accountId: string; statementId: string | null; line: ReviewLine; pickers: StatementPickers };
