import type { PermissionResource } from "./types";

/**
 * Finance day-to-day work: income, invoices, expenses, payments, recurring schedules, bank
 * statements, imports, projects, employees and the Reports page.
 *
 * Member defaults match what a member could do before roles existed:
 * - every page here was open to members except Bank statements (admin only);
 * - members could add and change income, invoices, expenses, projects and employees, record
 *   payments against bills and invoices, and download every report not marked admin only;
 * - only admins could delete income, invoices, expenses, projects, project documents, employees
 *   and bill payments, cancel or restore an invoice, swap a file already saved on a record,
 *   create or change recurring schedules, manage expense categories, upload bank statements and
 *   run imports (members saw the Import page with a note that only admins can import).
 * Salaries and company position figures follow the data permissions, not these resources.
 */
export const FINANCE_OPS_RESOURCES: PermissionResource[] = [
  {
    key: "finance.dashboard",
    module: "finance",
    group: "Overview",
    label: "Finance dashboard",
    description: "Totals, charts, due payments and project budgets. Cash, bank and balance-sheet figures on it also need Company financial position.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "finance.daily",
    module: "finance",
    group: "Overview",
    label: "Daily overview",
    description: "Income, expenses, payments and what is owed for one day or a range of days. Cash flow on it also needs Company financial position; salary rows follow Individual salaries.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "finance.income",
    module: "finance",
    group: "Income",
    label: "Income records",
    description: "Income records and the income summary. Delete also covers removing a receipt already saved on a record.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "finance.invoices",
    module: "finance",
    group: "Income",
    label: "Invoices & receivables",
    description: "Customer invoices and the receipts applied to them. Delete also covers cancelling or restoring an invoice and removing a file already saved on one.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "finance.expenses",
    module: "finance",
    group: "Expenses",
    label: "Expense records",
    description: "Expense records and the expense summary. Delete also covers removing a receipt already saved on a record. Salary expenses also need Individual salaries.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "finance.expense_categories",
    module: "finance",
    group: "Expenses",
    label: "Expense categories",
    description: "The category manager on the Expenses page: add, rename, hide and delete categories. Everyone who records expenses can still pick a category.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: [],
  },
  {
    key: "finance.payments",
    module: "finance",
    group: "Expenses",
    label: "Payment tracking",
    description: "Bills to pay and their payments. Create records a payment against a bill; delete removes one.",
    actions: ["view", "create", "delete"],
    memberDefault: ["view", "create"],
  },
  {
    key: "finance.recurring",
    module: "finance",
    group: "Expenses",
    label: "Recurring expenses",
    description: "Schedules for salaries, rent, bills and subscriptions. Edit covers pausing, resuming and posting a schedule now.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view"],
  },
  {
    key: "finance.bank_statements",
    module: "finance",
    group: "Expenses",
    label: "Bank statements",
    description:
      "Statement uploads and their lines, which show the bank balance and every payment, salaries included. Create uploads a statement and adds its lines; each new record also needs its own create permission (expenses, income, capital, loans, transfers). Edit unmatches a line from its record.",
    actions: ["view", "create", "edit"],
    memberDefault: [],
  },
  {
    key: "finance.import",
    module: "finance",
    group: "Expenses",
    label: "Import",
    description: "The Finance Import page. Create runs CSV and Excel imports of expenses and income and turns Google Drive bills into draft expenses.",
    actions: ["view", "create"],
    memberDefault: ["view"],
  },
  {
    key: "finance.projects",
    module: "finance",
    group: "Projects",
    label: "Projects",
    description: "Projects, their documents and their team. Delete also covers removing a project document.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "finance.project_finance",
    module: "finance",
    group: "Projects",
    label: "Profitability and budget tracking",
    description: "The project profitability and budget tracking pages.",
    actions: ["view"],
    memberDefault: ["view"],
  },
  {
    key: "finance.employees",
    module: "finance",
    group: "Projects",
    label: "Employees",
    description: "The employee list and profiles. Pay and salary history also need Individual salaries.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
  {
    key: "finance.reports",
    module: "finance",
    group: "Reports",
    label: "Reports",
    description:
      "The Reports page and downloads of the operational reports: finance, income, expense, GST, CA pack, project, project financials and inventory. The cash flow and budget report also needs Company financial position. Statement, asset, receivable, liability and equity reports need the export permission of their own area.",
    actions: ["view", "export"],
    memberDefault: ["view", "export"],
  },
  {
    key: "finance.audit",
    module: "finance",
    group: "Reports",
    label: "Audit trail",
    description:
      "Who added, edited, imported, reclassified, paid or deleted income, expenses and invoices, and when; also the History section on expense and income records. Salary entries also need Individual salaries.",
    actions: ["view"],
    memberDefault: [],
  },
];
