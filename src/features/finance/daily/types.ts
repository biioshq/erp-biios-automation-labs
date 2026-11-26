/** Client-safe types and small helpers of the Daily overview (/finance/daily). */

/** The longest range one page or report covers, so the per-day table and chart stay readable. */
export const MAX_DAILY_DAYS = 366;

export type DailyFilters = { project: string[]; vendor: string[]; category: string[] };

export type DailyDay = {
  day: string;
  /** Income received that day (excluding older records saved "On credit"). */
  income: number;
  incomeCount: number;
  /** Expenses dated that day, billed whether or not paid. */
  expenses: number;
  expenseCount: number;
  /** Payments made that day: explicit payments on their date, implied full payments on the expense date. */
  payments: number;
  paymentCount: number;
  /** Still owed to vendors at the end of the day, and the overdue part of it. */
  outstanding: number;
  overdue: number;
  /** Bank and cash movement from the books; null unless the cash figures are shown. */
  cashIn: number | null;
  cashOut: number | null;
  netCash: number | null;
};

export type VendorRow = { key: string; vendor: string; incurred: number; paid: number; owed: number };
export type CustomerRow = { key: string; client: string; received: number; count: number };

export type TransactionKind = "expense" | "payment" | "receipt" | "transfer";
export type TransactionRow = {
  key: string;
  kind: TransactionKind;
  day: string;
  party: string;
  title: string;
  detail: string;
  amount: number;
  href: string | null;
};

export type DailyOverview = {
  from: string;
  to: string;
  /** The range was longer than MAX_DAILY_DAYS and was shortened to its last days. */
  clamped: boolean;
  /** One calendar day (from equals to). */
  single: boolean;
  filters: DailyFilters;
  filtered: boolean;
  days: DailyDay[];
  totals: {
    income: number;
    incomeCount: number;
    /** Older income records saved "On credit": not money received, counted apart. */
    onCredit: { count: number; total: number };
    expenses: number;
    expenseCount: number;
    payments: number;
    paymentCount: number;
    /** Owed to vendors at the end of the last day. */
    outstanding: number;
    outstandingCount: number;
    overdue: number;
    overdueCount: number;
  };
  /**
   * The net cash figure and the basis it comes from. "ledger": cash and bank movement from the books,
   * transfers between own accounts left out (whole company, only without filters, and only with
   * Company financial position). "records": income received minus payments made, from the records
   * (narrowed by a project filter). null: not meaningful (a vendor or category filter narrows
   * payments but not income).
   */
  net: { basis: "ledger" | "records"; value: number; cashIn: number | null; cashOut: number | null } | null;
  vendors: VendorRow[];
  vendorCount: number;
  customers: CustomerRow[];
  customerCount: number;
  transactions: TransactionRow[];
  transactionTotal: number;
  /** Whether the figures leave out salary rows (the viewer has no Individual salaries). */
  salariesHidden: boolean;
  seesPosition: boolean;
};

/** Every "yyyy-mm-dd" from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  let t = Date.UTC(fy, fm - 1, fd);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = Date.UTC(ty, tm - 1, td);
  while (t <= end && out.length < 4000) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

/** The range from the URL: both ends given (a single day is from = to); reversed days are swapped. Missing ends default to the other end, or today. */
export function dailyRange(from: string | null, to: string | null, today: string): { from: string; to: string; clamped: boolean } {
  let f = from ?? to ?? today;
  let t = to ?? from ?? today;
  if (f > t) [f, t] = [t, f];
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const count = Math.round((ms(t) - ms(f)) / 86_400_000) + 1;
  if (count > MAX_DAILY_DAYS) return { from: new Date(ms(t) - (MAX_DAILY_DAYS - 1) * 86_400_000).toISOString().slice(0, 10), to: t, clamped: true };
  return { from: f, to: t, clamped: false };
}
