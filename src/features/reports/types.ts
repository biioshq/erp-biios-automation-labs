import type { ReportFormat, ReportType } from "@/lib/constants";

export type ColumnType = "text" | "money" | "number" | "date" | "percent";

export type ReportColumn = {
  key: string;
  header: string;
  type: ColumnType;
  /** Width in characters (Excel) and a hint for PDF layout. */
  width: number;
};

/** A cell: text, a number (money, quantity, ratio for percent), a "yyyy-mm-dd" IST day, or empty. */
export type ReportCell = string | number | null | undefined;

/** `_kind` marks subtotal rows so renderers can bold them. */
export type ReportRow = { _kind?: "subtotal" } & { [key: string]: ReportCell };

export type ReportTotals = Record<string, ReportCell>;

export type SummaryItem = { label: string; value: number | string; type?: ColumnType };

export type ReportSection = {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportTotals | null;
};

/**
 * What every builder returns and every renderer consumes. The flat fields are
 * the primary table; `sections` (when present) lists every table in order,
 * the primary one first, for reports made of several tables.
 */
export type ReportData = ReportSection & {
  type: ReportType;
  subtitle: string;
  summary: SummaryItem[];
  sections?: ReportSection[];
  /** CSV carries only the primary table (the CA pack). */
  csvPrimaryOnly?: boolean;
  /** The summary is already the first table, so files do not repeat it as a block. */
  hideSummaryBlock?: boolean;
  /**
   * A financial statement: its headings and totals are part of the statement, so the CSV keeps
   * subtotal rows too (a register's CSV drops them so a column adds up once).
   */
  statement?: boolean;
};

/** How the Profit & Loss lays out its columns: one total, or a column per month, quarter or year. */
export type PlColumns = "total" | "month" | "quarter" | "year";

/** The normalised filters every report accepts. */
export type ReportFilters = {
  from: string | null;
  to: string | null;
  project: string[];
  vendor: string[];
  /** Customer statement only: customer names. Older log rows lack it. */
  customer?: string[];
  category: string[];
  /** Inventory only: the movement ledger instead of the valuation. */
  movements: boolean;
  /** Expense list passthrough filters. */
  q: string;
  stage: string[];
  paymentMethod: string[];
  source: string[];
  /** Movement ledger passthrough filters. */
  movementType: string[];
  item: string[];
  /** Profit & Loss only: one total column or a column per sub-period. Older log rows lack it. */
  columns?: PlColumns;
  /** Expense report only: the Expenses list's payment status, direct / indirect and department filters. Older log rows lack them. */
  status?: string[];
  nature?: string[];
  department?: string[];
  /** Expense report only: "yes" keeps expenses from or paid through a bank statement line. */
  bank?: string[];
};

export type ReportPreviewSection = ReportSection & { totalRows: number };

/** A report trimmed for the screen: summary plus the first rows of each table. */
export type ReportPreview = {
  type: ReportType;
  title: string;
  subtitle: string;
  summary: SummaryItem[];
  sections: ReportPreviewSection[];
  rowCount: number;
};

export type ReportHistoryRow = {
  id: string;
  type: ReportType;
  format: ReportFormat;
  title: string;
  filtersSummary: string;
  rowCount: number;
  by: string | null;
  createdAt: string;
  href: string;
};
