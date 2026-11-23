/**
 * The built-in groups of the balance sheet: what assets, liabilities and equity are split into.
 * Client-safe. Records store a group's key (or the id of a subgroup an admin added under one,
 * src/server/models/finance-group.ts), so the labels here can change without touching data.
 * Never change or remove a key.
 */

export type FinanceKind = "asset" | "liability" | "equity";

export type BuiltInGroup = {
  key: string;
  label: string;
  kind: FinanceKind;
  /** The group it sits under; null for the top of a side (Current assets, Non-current liabilities, Equity groups). */
  parent: string | null;
  description?: string;
  /** Where records of this group come from: entered on its own page, or computed from other records. */
  source?: "fixed_assets" | "investments" | "liabilities" | "equity" | "computed";
};

export const BUILT_IN_GROUPS: BuiltInGroup[] = [
  // Assets
  { key: "current_assets", label: "Current assets", kind: "asset", parent: null, description: "Cash and what turns into cash within a year." },
  { key: "inventory", label: "Inventory", kind: "asset", parent: "current_assets", source: "computed", description: "Stock in storage, from Inventory." },
  { key: "cash_equivalents", label: "Cash and cash equivalents", kind: "asset", parent: "current_assets", source: "computed", description: "Cash in hand and bank balances." },
  { key: "receivables", label: "Accounts receivable", kind: "asset", parent: "current_assets", source: "computed", description: "What customers still owe on invoices." },
  { key: "prepaid", label: "Prepaid expenses", kind: "asset", parent: "current_assets", source: "computed", description: "Expenses paid for a period not used yet." },
  { key: "short_term_advances", label: "Short-term advances", kind: "asset", parent: "current_assets", source: "computed", description: "Advances paid to suppliers and staff." },
  { key: "gst_receivable", label: "GST input credit", kind: "asset", parent: "current_assets", source: "computed", description: "GST paid on purchases more than GST charged on sales." },
  { key: "other_current_assets", label: "Other current assets", kind: "asset", parent: "current_assets", source: "fixed_assets" },
  { key: "non_current_assets", label: "Non-current assets", kind: "asset", parent: null, description: "What the business keeps and uses for more than a year." },
  { key: "fixed_assets", label: "Fixed assets", kind: "asset", parent: "non_current_assets", source: "fixed_assets" },
  { key: "furniture_fixtures", label: "Furniture and fixtures", kind: "asset", parent: "fixed_assets", source: "fixed_assets", description: "Tables, chairs, cupboards, storage racks." },
  { key: "plant_machinery", label: "Plant and machinery", kind: "asset", parent: "fixed_assets", source: "fixed_assets", description: "Machines, tools and test equipment." },
  { key: "vehicles", label: "Vehicles", kind: "asset", parent: "fixed_assets", source: "fixed_assets" },
  { key: "land_buildings", label: "Land and buildings", kind: "asset", parent: "fixed_assets", source: "fixed_assets" },
  { key: "computers_electronics", label: "Computers and electronics", kind: "asset", parent: "fixed_assets", source: "fixed_assets", description: "Laptops, desktops, phones, networking." },
  { key: "intangible_assets", label: "Intangible assets", kind: "asset", parent: "non_current_assets", source: "fixed_assets" },
  { key: "software", label: "Software", kind: "asset", parent: "intangible_assets", source: "fixed_assets" },
  { key: "licences", label: "Licences", kind: "asset", parent: "intangible_assets", source: "fixed_assets" },
  { key: "long_term_investments", label: "Long-term investments", kind: "asset", parent: "non_current_assets", source: "investments" },
  { key: "other_long_term_assets", label: "Other long-term assets", kind: "asset", parent: "non_current_assets", source: "fixed_assets" },
  // Liabilities
  { key: "current_liabilities", label: "Current liabilities", kind: "liability", parent: null, description: "What is owed within a year." },
  { key: "accounts_payable", label: "Accounts payable", kind: "liability", parent: "current_liabilities", source: "computed", description: "Unpaid supplier and vendor bills, from Expenses." },
  { key: "short_term_loans", label: "Short-term loans", kind: "liability", parent: "current_liabilities", source: "liabilities" },
  { key: "outstanding_expenses", label: "Outstanding expenses", kind: "liability", parent: "current_liabilities", source: "liabilities" },
  { key: "salaries_payable", label: "Salaries and wages payable", kind: "liability", parent: "current_liabilities", source: "liabilities" },
  { key: "taxes_payable", label: "Taxes payable", kind: "liability", parent: "current_liabilities", source: "liabilities", description: "GST from invoices less input credit, plus TDS and other taxes entered here." },
  { key: "customer_advances", label: "Customer advances", kind: "liability", parent: "current_liabilities", source: "computed", description: "Advances received not yet earned." },
  { key: "group_company_payable", label: "Due to Biios Startup LLP", kind: "liability", parent: "current_liabilities", source: "computed", description: "Paid on the company's behalf through the group company." },
  { key: "other_current_liabilities", label: "Other current liabilities", kind: "liability", parent: "current_liabilities", source: "liabilities" },
  { key: "non_current_liabilities", label: "Non-current liabilities", kind: "liability", parent: null, description: "What is owed after more than a year." },
  { key: "long_term_bank_loans", label: "Long-term bank loans", kind: "liability", parent: "non_current_liabilities", source: "liabilities" },
  { key: "business_loans", label: "Business loans", kind: "liability", parent: "non_current_liabilities", source: "liabilities" },
  { key: "other_long_term_borrowings", label: "Other long-term borrowings", kind: "liability", parent: "non_current_liabilities", source: "liabilities" },
  // Equity
  { key: "owners_capital", label: "Owner's capital", kind: "equity", parent: null, source: "equity" },
  { key: "investors_capital", label: "Investors' capital", kind: "equity", parent: null, source: "equity" },
  { key: "retained_earnings", label: "Retained earnings", kind: "equity", parent: null, source: "computed" },
  { key: "reserves_surplus", label: "Reserves and surplus", kind: "equity", parent: null, source: "equity" },
  { key: "general_reserve", label: "General reserve", kind: "equity", parent: "reserves_surplus", source: "equity" },
  { key: "other_reserves", label: "Other reserves", kind: "equity", parent: "reserves_surplus", source: "equity" },
  { key: "drawings", label: "Drawings", kind: "equity", parent: null, source: "equity" },
];

const BY_KEY = new Map(BUILT_IN_GROUPS.map((g) => [g.key, g]));

export const builtInGroup = (key: string) => BY_KEY.get(key);
export const isBuiltInGroup = (key: string) => BY_KEY.has(key);

/** The built-in keys a group sits under, nearest first (furniture_fixtures → fixed_assets → non_current_assets). */
export function builtInAncestors(key: string): string[] {
  const out: string[] = [];
  let g = BY_KEY.get(key);
  while (g?.parent) {
    out.push(g.parent);
    g = BY_KEY.get(g.parent);
  }
  return out;
}

/** Group keys under which fixed-asset records can be filed (tangible), and intangible ones. */
export const FIXED_ASSET_ROOT = "fixed_assets";
export const INTANGIBLE_ROOT = "intangible_assets";
/** Liability groups whose records are entered on the Liabilities pages. */
export const LIABILITY_ENTRY_GROUPS = BUILT_IN_GROUPS.filter((g) => g.kind === "liability" && g.source === "liabilities").map((g) => g.key);
/** Current vs non-current for a built-in liability group. */
export const isCurrentLiabilityGroup = (key: string) => builtInAncestors(key).includes("current_liabilities") || key === "current_liabilities";
