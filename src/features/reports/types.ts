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
};

/** The normalised filters every report accepts. */
export type ReportFilters = {
  from: string | null;
  to: string | null;
  project: string[];
  vendor: string[];
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
