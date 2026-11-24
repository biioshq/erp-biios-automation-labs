import type { PermissionResource } from "./types";

/**
 * The books: assets, liabilities, equity, the financial statements and finance subgroups.
 *
 * Member defaults match what a member could do before roles existed:
 * - Admin-only pages and every action on them: Assets overview, Cash & bank, Investments,
 *   Liabilities (with accounts payable and loans), Capital / Equity and the four statements.
 * - Open to members: Receivables, Prepaid expenses, Inventory valuation, Fixed assets,
 *   Depreciation and Intangible assets, and the receivables, fixed asset and depreciation reports
 *   on the Reports page (export). On fixed and intangible assets members could add, edit,
 *   archive, restore, record maintenance and disposals and attach documents; deleting an asset,
 *   a maintenance entry, a disposal, a document or the bill an asset created was admin-only.
 * - Subgroups: anyone could add or rename one; removing one was admin-only.
 */
export const FINANCE_BOOKS_RESOURCES: PermissionResource[] = [
  {
    key: "finance.assets_overview",
    module: "finance",
    group: "Assets",
    label: "Assets overview",
    description: "Total, current and non-current assets from the books.",
    actions: ["view"],
    memberDefault: [],
  },
  {
    key: "finance.cash_bank",
    module: "finance",
    group: "Assets",
    label: "Cash & bank",
    description:
      "Bank and cash balances, account history and transfers. Create adds accounts and records transfers. Edit changes, archives and restores accounts. Delete removes transfers.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: [],
  },
  {
    key: "finance.receivables",
    module: "finance",
    group: "Assets",
    label: "Receivables",
    description: "What customers owe on issued invoices. Export downloads the receivables report. The balance sheet figure also needs the financial position permission.",
    actions: ["view", "export"],
    memberDefault: ["view", "export"],
  },
  {
    key: "finance.prepaid",
    module: "finance",
    group: "Assets",
    label: "Prepaid expenses",
    description: "Expenses paid in advance and the part not used yet.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "finance.inventory_valuation",
    module: "finance",
    group: "Assets",
    label: "Inventory valuation",
    description: "Stock in storage, in use and wasted, valued at cost.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "finance.fixed_assets",
    module: "finance",
    group: "Assets",
    label: "Fixed assets, depreciation and intangibles",
    description:
      "The fixed and intangible asset registers and the depreciation summary. Edit covers changes, maintenance, disposals, archiving and adding documents. Delete covers deleting assets, maintenance entries, disposals and documents; deleting the unpaid bill an asset created also needs expense delete. Export downloads the fixed asset and depreciation reports.",
    actions: ["view", "create", "edit", "delete", "export"],
    memberDefault: ["view", "create", "edit", "export"],
  },
  {
    key: "finance.investments",
    module: "finance",
    group: "Assets",
    label: "Long-term investments",
    description: "Deposits, funds, shares and bonds. Edit covers changes, redemptions, archiving and adding documents. Delete covers deleting investments, redemptions and documents.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: [],
  },
  {
    key: "finance.liabilities",
    module: "finance",
    group: "Liabilities & equity",
    label: "Liabilities",
    description:
      "Liabilities overview, current and non-current liabilities, accounts payable and loans. Edit covers changes, repayments and adding documents. Delete covers deleting liabilities, repayments and documents. Export downloads the payables and liabilities reports.",
    actions: ["view", "create", "edit", "delete", "export"],
    memberDefault: [],
  },
  {
    key: "finance.equity",
    module: "finance",
    group: "Liabilities & equity",
    label: "Capital / Equity",
    description:
      "Owners' and investors' capital, drawings, reserves and retained earnings. Create records entries and adds people. Edit changes entries and people, and archives or restores people. Delete removes entries and people. Export downloads the equity report.",
    actions: ["view", "create", "edit", "delete", "export"],
    memberDefault: [],
  },
  {
    key: "finance.statements",
    module: "finance",
    group: "Financial statements",
    label: "Financial statements",
    description: "Balance sheet, profit and loss, cash flow and trial balance pages, and their PDF, Excel and CSV downloads.",
    actions: ["view", "export"],
    memberDefault: [],
  },
  {
    key: "finance.groups",
    module: "finance",
    group: "Financial statements",
    label: "Finance subgroups",
    description: "Subgroups under assets, liabilities and reserves. Create adds one, edit renames one, delete removes an empty one.",
    actions: ["create", "edit", "delete"],
    memberDefault: ["create", "edit"],
  },
];
