import type { ReportType } from "@/lib/constants";
import { resourceOf } from "@/lib/permissions";

/**
 * What each report is, which filters it takes and who may open it. Plain data with no icons, so
 * the download route and the URL parsing can read it without loading UI code (./meta.ts adds the icons).
 */

/**
 * "date" is a period (from and to); "asOf" is one day, kept in `to`; "columns" is the Profit &
 * Loss column layout (one total, or per month, quarter or year).
 */
export type ReportFilterKey = "date" | "asOf" | "project" | "vendor" | "customer" | "category" | "columns";

/** The headings the report cards are grouped under, in order. */
export const REPORT_GROUPS = [
  { key: "statements", label: "Financial statements" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expense" },
  { key: "asset", label: "Asset" },
  { key: "liability", label: "Liability" },
  { key: "equity", label: "Capital & equity" },
  { key: "project", label: "Project" },
  { key: "cash", label: "Cash flow & budget" },
] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number]["key"];

export type ReportInfo = {
  type: ReportType;
  label: string;
  description: string;
  contains: string[];
  /** Filters that change this report. Others are hidden. */
  filters: ReportFilterKey[];
  /** Which category list the category filter uses. */
  categories?: "expense" | "income" | "inventory";
  group: ReportGroup;
  /** The on-screen statement page, when the report has one. */
  page?: string;
};

export const REPORT_CATALOG: ReportInfo[] = [
  {
    type: "finance",
    group: "statements",
    label: "Finance",
    description: "Income received against expenses recorded, for the period.",
    contains: ["Income and expenses by category", "Profit and margin", "Month by month table"],
    filters: ["date", "project"],
  },
  {
    type: "expense",
    group: "expense",
    label: "Expense",
    description: "Every expense with its GST split.",
    contains: ["Vendor, project, stage, category", "Taxable value, CGST, SGST, IGST, CESS", "GSTIN and invoice number"],
    filters: ["date", "project", "vendor", "category"],
    categories: "expense",
  },
  {
    type: "income",
    group: "income",
    label: "Income",
    description: "Payments received, by client and project.",
    contains: ["Client, project, category", "Payment method and reference", "Totals"],
    filters: ["date", "project", "category"],
    categories: "income",
  },
  {
    type: "gst",
    group: "expense",
    label: "GST",
    description: "Input tax credit register for return filing.",
    contains: ["GST on expenses and stock purchases", "Totals by tax head and by GSTIN", "HSN or SAC codes"],
    filters: ["date", "project", "vendor", "category"],
    categories: "expense",
  },
  {
    type: "project",
    group: "project",
    label: "Project",
    description: "Budget against spend and income per project.",
    contains: ["Budget, spent, remaining, usage", "Spend across the 7 stages", "Income and profit"],
    filters: ["project"],
  },
  {
    type: "inventory",
    group: "asset",
    label: "Inventory",
    description: "Stock valuation or the movement ledger.",
    contains: ["On-hand and allocated value", "Category subtotals and stock status", "Optional movement ledger"],
    filters: ["category"],
    categories: "inventory",
  },
  {
    type: "ca",
    group: "statements",
    label: "CA pack",
    description: "One pack for your chartered accountant.",
    contains: ["Summary with GST input by head", "Expense, income and GST registers", "Vendor-wise totals"],
    filters: ["date", "project", "vendor", "category"],
    categories: "expense",
  },
  {
    type: "balance_sheet",
    group: "statements",
    page: "/finance/reports/balance-sheet",
    label: "Balance sheet",
    description: "Assets, liabilities and equity on one day.",
    contains: ["Current and non-current assets and liabilities", "Equity with retained earnings", "Balanced check"],
    filters: ["asOf"],
  },
  {
    type: "profit_loss",
    group: "statements",
    page: "/finance/reports/profit-loss",
    label: "Profit & loss",
    description: "Accrual profit and loss from the books.",
    contains: ["Revenue, cost of materials, direct and indirect costs", "Gross and net profit", "Monthly, quarterly or yearly columns"],
    filters: ["date", "columns"],
  },
  {
    type: "cash_flow",
    group: "statements",
    page: "/finance/reports/cash-flow",
    label: "Cash flow statement",
    description: "Cash in and out by activity (direct method).",
    contains: ["Operating, investing and financing", "Net change in cash", "Opening and closing cash per account"],
    filters: ["date"],
  },
  {
    type: "trial_balance",
    group: "statements",
    page: "/finance/reports/trial-balance",
    label: "Trial balance",
    description: "Every ledger account's debit or credit balance.",
    contains: ["Accounts by type", "Debit and credit totals", "Balanced check"],
    filters: ["asOf"],
  },
  {
    type: "receivables",
    group: "income",
    label: "Receivables",
    description: "What customers still owe on invoices, today.",
    contains: ["Customer-wise outstanding and overdue", "Every open invoice with due date", "Received against each invoice"],
    filters: [],
  },
  {
    type: "payables",
    group: "liability",
    label: "Payables",
    description: "What is still owed to vendors, today.",
    contains: ["Vendor-wise outstanding and overdue", "Every unpaid or part-paid bill", "Due dates and status"],
    filters: [],
  },
  {
    type: "liabilities",
    group: "liability",
    label: "Liabilities",
    description: "Current and non-current liabilities and loans.",
    contains: ["Liabilities from the balance sheet", "Loan outstanding: lender, original, paid, rate", "Due date and status"],
    filters: [],
  },
  {
    type: "fixed_assets",
    group: "asset",
    label: "Fixed asset register",
    description: "Every fixed and intangible asset with its book value.",
    contains: ["Code, group, purchase date, cost", "Accumulated depreciation and book value", "Location and condition"],
    filters: ["asOf"],
  },
  {
    type: "depreciation",
    group: "asset",
    label: "Depreciation",
    description: "Depreciation charged in a period, by group and asset.",
    contains: ["Opening value and depreciation charged", "Accumulated depreciation", "Book value at the end"],
    filters: ["date"],
  },
  {
    type: "equity",
    group: "equity",
    label: "Capital & equity",
    description: "Owners' and investors' capital, drawings and retained earnings.",
    contains: ["Owner and investor capital summaries", "Contribution history and drawings", "Retained earnings"],
    filters: ["asOf"],
  },
  {
    type: "project_financials",
    group: "project",
    label: "Project financials",
    description: "Profitability, budget against actual and cost summary.",
    contains: ["Income, invoiced, spent and profit per project", "Budget against actual by stage", "Cost by category"],
    filters: ["project"],
  },
  {
    type: "cash_budget",
    group: "cash",
    label: "Cash flow & budget",
    description: "Cash in and out, cash position and what is expected.",
    contains: ["Cash inflow, outflow and position", "Expected payments and receipts", "Budget allocation against actual"],
    filters: ["date"],
  },
  {
    type: "vendor_statement",
    group: "expense",
    label: "Vendor statement",
    description: "Bills, payments and what is still owed to a vendor.",
    contains: ["Bills in the period with paid and outstanding today", "Payments made in the period", "Outstanding to each vendor today"],
    filters: ["date", "vendor"],
  },
  {
    type: "customer_statement",
    group: "income",
    label: "Customer statement",
    description: "Invoices, receipts and the balance for a customer.",
    contains: ["Invoices in the period with received and outstanding", "Receipts in the period", "What the customer owes today"],
    filters: ["date", "customer"],
  },
];

/**
 * The reports that existed before the financial statements. Their filters, file names and export
 * log wording stay exactly as they were; the newer reports follow their meta's filters.
 */
const LEGACY = new Set<ReportType>(["finance", "expense", "income", "gst", "project", "inventory", "ca"]);
export const isLegacyReport = (type: ReportType) => LEGACY.has(type);

/**
 * What building or downloading a report needs: every permission listed. The operational reports
 * need the Reports export permission; statements, assets, receivables, liabilities and equity need
 * the export permission of their own area (its view permission while that area has no export
 * action); cash flow and budget also needs the company position. These match what members could
 * download before roles existed: the reports marked admin only then need a permission members do
 * not get by default.
 */
const exportOf = (resource: string) => (resourceOf(resource)?.actions.includes("export") ? `${resource}:export` : `${resource}:view`);

const REPORT_PERMISSIONS: Record<Exclude<ReportType, "scenario">, string[]> = {
  finance: ["finance.reports:export"],
  expense: ["finance.reports:export"],
  income: ["finance.reports:export"],
  gst: ["finance.reports:export"],
  project: ["finance.reports:export"],
  inventory: ["finance.reports:export"],
  ca: ["finance.reports:export"],
  project_financials: ["finance.reports:export"],
  cash_budget: ["finance.reports:export", "data.financial_position"],
  balance_sheet: ["finance.statements:export"],
  profit_loss: ["finance.statements:export"],
  cash_flow: ["finance.statements:export"],
  trial_balance: ["finance.statements:export"],
  receivables: [exportOf("finance.receivables")],
  payables: [exportOf("finance.liabilities")],
  liabilities: [exportOf("finance.liabilities")],
  fixed_assets: [exportOf("finance.fixed_assets")],
  depreciation: [exportOf("finance.fixed_assets")],
  equity: [exportOf("finance.equity")],
  // The vendor statement is the expense report plus payments and outstanding (members export the expense report by default).
  vendor_statement: ["finance.reports:export"],
  // The customer statement lists invoices and receipts: the receivables area's export as well.
  customer_statement: ["finance.reports:export", exportOf("finance.receivables")],
};

/** The permissions a report type needs, all of them. A type without a card (scenario) is never built here. */
export function reportPermissions(type: ReportType): string[] | null {
  return type === "scenario" ? null : (REPORT_PERMISSIONS[type] ?? null);
}

/** Whether someone with the given permission check may build or download this report. */
export function mayExportReport(type: ReportType, can: (permission: string) => boolean): boolean {
  const needed = reportPermissions(type);
  return Boolean(needed && needed.every(can));
}

export const reportInfo = (type: string | undefined) => REPORT_CATALOG.find((m) => m.type === type);
