/**
 * Types of the accounting engine's output (src/server/accounting), shared with client components.
 * Client-safe. Amounts are rupees rounded to paise; in a posting a debit is positive and a credit
 * negative, so the postings of one record always add up to zero.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/** Where an income or expense account sits in the Profit & Loss statement. */
export type PlSection = "revenue" | "other_income" | "materials" | "direct" | "indirect" | "depreciation" | "finance" | "other_expense";

export const PL_SECTION_LABELS: Record<PlSection, string> = {
  revenue: "Revenue from operations",
  other_income: "Other income",
  materials: "Cost of materials consumed",
  direct: "Direct expenses",
  indirect: "Indirect expenses",
  depreciation: "Depreciation and amortisation",
  finance: "Finance costs",
  other_expense: "Stock write-offs and other losses",
};

export type CashActivity = "operating" | "investing" | "financing" | "internal";

export type SourceKind =
  | "expense"
  | "expense_payment"
  | "income"
  | "invoice"
  | "movement"
  | "fixed_asset"
  | "investment"
  | "liability"
  | "liability_payment"
  | "capital"
  | "bank_account"
  | "transfer"
  | "accrual";

export type PostingSource = { kind: SourceKind; id: string; label: string; href?: string };

export type Posting = {
  date: Date;
  account: string;
  amount: number;
  source: PostingSource;
  memo?: string;
  /** Set on postings to cash and bank accounts: which part of the cash flow statement they belong to. */
  cf?: { activity: CashActivity; line: string };
};

export type LedgerAccountMeta = {
  code: string;
  name: string;
  type: AccountType;
  /** Balance sheet: the built-in group key (or subgroup id) it adds to. */
  group?: string;
  /** Profit & Loss: the section it adds to. */
  pl?: PlSection;
  /** Contra accounts (accumulated depreciation) reduce their group. */
  contra?: boolean;
  /** Cash and bank accounts. */
  cash?: boolean;
};

export type TrialBalanceRow = { code: string; name: string; type: AccountType; debit: number; credit: number };

export type StatementLine = { key: string; label: string; amount: number; href?: string; note?: string; children?: StatementLine[] };

export type BalanceSheet = {
  asOf: string;
  assets: { current: StatementLine[]; nonCurrent: StatementLine[]; totalCurrent: number; totalNonCurrent: number; total: number };
  liabilities: { current: StatementLine[]; nonCurrent: StatementLine[]; totalCurrent: number; totalNonCurrent: number; total: number };
  equity: { lines: StatementLine[]; total: number };
  /** Assets − (liabilities + equity); 0 when the books balance. */
  difference: number;
};

export type ProfitAndLoss = {
  from: string;
  to: string;
  sections: { key: PlSection; label: string; lines: StatementLine[]; total: number }[];
  totalIncome: number;
  totalExpenses: number;
  grossProfit: number;
  profit: number;
};

export type CashFlow = {
  from: string;
  to: string;
  opening: number;
  closing: number;
  activities: { key: Exclude<CashActivity, "internal">; label: string; lines: StatementLine[]; net: number }[];
  netChange: number;
  /** Per account: opening, in, out, closing. */
  accounts: { code: string; name: string; opening: number; inflow: number; outflow: number; closing: number }[];
};
