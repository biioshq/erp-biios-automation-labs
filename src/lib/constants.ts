/**
 * Domain enums shared by models, Zod schemas and the UI. Client-safe.
 * Add a value here and it flows to validation, filters and badges.
 */

const options = <T extends string>(entries: readonly { value: T; label: string }[]) => entries;
export const valuesOf = <T extends string>(entries: readonly { value: T }[]) =>
  entries.map((e) => e.value) as [T, ...T[]];
export const labelOf = <T extends string>(entries: readonly { value: T; label: string }[], value: T | null | undefined) =>
  entries.find((e) => e.value === value)?.label ?? value ?? "";

/* Projects */

export const PROJECT_STAGES = options([
  { value: "research", label: "Research" },
  { value: "design", label: "Design" },
  { value: "prototype", label: "Prototype" },
  { value: "development", label: "Development" },
  { value: "testing", label: "Testing" },
  { value: "production", label: "Production" },
  { value: "deployment", label: "Deployment" },
] as const);
export type ProjectStage = (typeof PROJECT_STAGES)[number]["value"];

export const PROJECT_STATUSES = options([
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const);
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];

export const PROJECT_DOCUMENT_TYPES = options([
  { value: "quotation", label: "Quotation" },
  { value: "receipt", label: "Receipt" },
  { value: "bill", label: "Bill" },
  { value: "drawing", label: "Drawing" },
  { value: "contract", label: "Contract" },
  { value: "other", label: "Other" },
] as const);
export type ProjectDocumentType = (typeof PROJECT_DOCUMENT_TYPES)[number]["value"];

/* Finance */

/**
 * The built-in expense categories. Admins can rename or hide them and add their own (stored in
 * expenseCategories): show and pick categories through src/lib/expense-categories.ts, not this list.
 * Never change a value here: expenses store it.
 */
export const EXPENSE_CATEGORIES = options([
  { value: "materials", label: "Materials" },
  { value: "inventory", label: "Inventory" },
  { value: "equipment", label: "Equipment" },
  { value: "salaries", label: "Salaries & wages" },
  { value: "labour", label: "Labour" },
  { value: "contractors", label: "Contractors" },
  { value: "software", label: "Software & SaaS" },
  { value: "travel", label: "Travel" },
  { value: "logistics", label: "Logistics" },
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "professional_fees", label: "Professional fees" },
  { value: "marketing", label: "Marketing" },
  { value: "office", label: "Office" },
  { value: "maintenance", label: "Repairs & maintenance" },
  { value: "interest", label: "Interest & bank charges" },
  { value: "other", label: "Other" },
] as const);
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export const PAYMENT_METHODS = options([
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "credit", label: "On credit" },
  /** Paid (or received) through the group company. */
  { value: "biios_startup_llp", label: "Biios Startup LLP" },
  /** Generated expenses for stock taken from inventory (already paid at purchase). */
  { value: "stock", label: "From stock" },
  { value: "other", label: "Other" },
] as const);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

/** Where an expense came from. Generated expenses are edited through their source, not by hand. */
export const EXPENSE_SOURCES = options([
  { value: "manual", label: "Manual" },
  { value: "inventory_assignment", label: "Inventory assignment" },
  /** Created when stock is bought: the cash spent. Edited through the purchase, not by hand. */
  { value: "inventory_purchase", label: "Stock purchase" },
  { value: "recurring", label: "Recurring" },
  /** Cost of not-yet-expensed stock that was wasted. Edited through inventory, not by hand. */
  { value: "inventory_wastage", label: "Stock wastage" },
  /** The interest part of a loan repayment. Edited through the loan, not by hand. */
  { value: "liability_interest", label: "Loan interest" },
] as const);
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number]["value"];

export const INCOME_CATEGORIES = options([
  { value: "project_payment", label: "Project payment" },
  { value: "advance", label: "Advance" },
  { value: "retainer", label: "Retainer" },
  { value: "product_sale", label: "Product sale" },
  { value: "grant", label: "Grant" },
  { value: "interest", label: "Interest income" },
  { value: "other", label: "Other" },
] as const);
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]["value"];

/* Inventory */

export const INVENTORY_UNITS = options([
  { value: "pcs", label: "Pieces" },
  { value: "set", label: "Sets" },
  { value: "box", label: "Boxes" },
  { value: "kg", label: "Kilograms" },
  { value: "g", label: "Grams" },
  { value: "m", label: "Metres" },
  { value: "ft", label: "Feet" },
  { value: "l", label: "Litres" },
  { value: "roll", label: "Rolls" },
  { value: "sheet", label: "Sheets" },
  { value: "pair", label: "Pairs" },
] as const);
export type InventoryUnit = (typeof INVENTORY_UNITS)[number]["value"];

export const MOVEMENT_TYPES = options([
  { value: "purchase", label: "Purchased" },
  { value: "assign", label: "Assigned to project" },
  { value: "return", label: "Returned from project" },
  { value: "adjustment", label: "Manual adjustment" },
  /** Stock written off: damaged, expired, lost. From storage it leaves stock; from a project it was in use there. */
  { value: "wastage", label: "Wasted" },
  /** An item moved to another storage location (stock levels unchanged). */
  { value: "transfer", label: "Moved location" },
] as const);
export type MovementType = (typeof MOVEMENT_TYPES)[number]["value"];

export const STOCK_STATUSES = options([
  { value: "in_stock", label: "In Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
] as const);
export type StockStatus = (typeof STOCK_STATUSES)[number]["value"];

/* Tasks */

export const TASK_STATUSES = options([
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const);
export type TaskStatus = (typeof TASK_STATUSES)[number]["value"];

export const TASK_PRIORITIES = options([
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
] as const);
export type TaskPriority = (typeof TASK_PRIORITIES)[number]["value"];

/* Reports */

export const REPORT_TYPES = options([
  { value: "finance", label: "Finance report" },
  { value: "expense", label: "Expense report" },
  { value: "income", label: "Income report" },
  { value: "gst", label: "GST report" },
  { value: "project", label: "Project report" },
  { value: "inventory", label: "Inventory report" },
  { value: "ca", label: "CA report" },
] as const);
export type ReportType = (typeof REPORT_TYPES)[number]["value"];

export const REPORT_FORMATS = options([
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel" },
  { value: "csv", label: "CSV" },
] as const);
export type ReportFormat = (typeof REPORT_FORMATS)[number]["value"];

/* Recurring expenses */

export const RECURRING_FREQUENCIES = options([
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Every 6 months" },
  { value: "yearly", label: "Yearly" },
] as const);
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]["value"];

export const RECURRING_STATUSES = options([
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
] as const);
export type RecurringStatus = (typeof RECURRING_STATUSES)[number]["value"];

/* Employees */

export const DEPARTMENTS = options([
  { value: "engineering", label: "Engineering" },
  { value: "installation", label: "Field installation" },
  { value: "design", label: "Design" },
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance & admin" },
  { value: "management", label: "Management" },
] as const);
export type Department = (typeof DEPARTMENTS)[number]["value"];

export const EMPLOYMENT_TYPES = options([
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
] as const);
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["value"];

export const EMPLOYEE_STATUSES = options([
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "exited", label: "Exited" },
] as const);
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]["value"];

/* Users */

export const USER_ROLES = options([
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const);
export type UserRole = (typeof USER_ROLES)[number]["value"];

/* Finance: payments, accounts, balance sheet */

/** Where an expense stands against what was paid on it. Derived, never stored (src/lib/payments.ts). */
export const PAYMENT_STATUSES = options([
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partly paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
] as const);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]["value"];

/** Direct costs belong to delivering projects; indirect ones are overheads. */
export const EXPENSE_NATURES = options([
  { value: "direct", label: "Direct" },
  { value: "indirect", label: "Indirect" },
] as const);
export type ExpenseNature = (typeof EXPENSE_NATURES)[number]["value"];

export const BANK_ACCOUNT_KINDS = options([
  { value: "bank", label: "Bank account" },
  { value: "cash", label: "Cash in hand" },
] as const);
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number]["value"];

export const INVOICE_STATUSES = options([
  { value: "issued", label: "Issued" },
  { value: "cancelled", label: "Cancelled" },
] as const);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]["value"];

export const DEPRECIATION_METHODS = options([
  { value: "slm", label: "Straight line" },
  { value: "wdv", label: "Written down value" },
  { value: "none", label: "Not depreciated" },
] as const);
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number]["value"];

export const ASSET_CONDITIONS = options([
  { value: "good", label: "Good" },
  { value: "under_maintenance", label: "Under maintenance" },
  { value: "damaged", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "disposed", label: "Disposed" },
] as const);
export type AssetCondition = (typeof ASSET_CONDITIONS)[number]["value"];

/** How a fixed asset was paid for. One record per purchase: an asset bought through an expense links it. */
export const ASSET_FUNDING = options([
  { value: "expense", label: "Paid through an expense already recorded" },
  { value: "paid", label: "Paid from a bank or cash account" },
  { value: "unpaid", label: "Not paid yet" },
  { value: "opening", label: "Owned before the books started" },
] as const);
export type AssetFunding = (typeof ASSET_FUNDING)[number]["value"];

export const INVESTMENT_TYPES = options([
  { value: "fixed_deposit", label: "Fixed deposit" },
  { value: "mutual_fund", label: "Mutual fund" },
  { value: "shares", label: "Shares" },
  { value: "bonds", label: "Bonds / debentures" },
  { value: "property", label: "Property" },
  { value: "other", label: "Other" },
] as const);
export type InvestmentType = (typeof INVESTMENT_TYPES)[number]["value"];

/** What a liability is: a loan carries interest and repayments; "other" is any other obligation. */
export const LIABILITY_KINDS = options([
  { value: "loan", label: "Loan or borrowing" },
  { value: "other", label: "Other obligation" },
] as const);
export type LiabilityKind = (typeof LIABILITY_KINDS)[number]["value"];

/** Where the money of a liability went when it was taken on. */
export const LIABILITY_SOURCES = options([
  { value: "account", label: "Received into a bank or cash account" },
  { value: "opening", label: "Owed before the books started" },
] as const);
export type LiabilitySource = (typeof LIABILITY_SOURCES)[number]["value"];

export const LIABILITY_STATUSES = options([
  { value: "pending", label: "Pending" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
] as const);
export type LiabilityStatus = (typeof LIABILITY_STATUSES)[number]["value"];

export const EQUITY_HOLDER_KINDS = options([
  { value: "owner", label: "Owner" },
  { value: "investor", label: "Investor" },
] as const);
export type EquityHolderKind = (typeof EQUITY_HOLDER_KINDS)[number]["value"];

/**
 * Capital / equity entries. Money in from owners and investors, drawings and dividends move cash;
 * reserve transfers and opening retained earnings only move value inside equity. None is income or expense.
 */
export const CAPITAL_ENTRY_TYPES = options([
  { value: "capital", label: "Capital introduced" },
  { value: "drawing", label: "Drawing" },
  { value: "dividend", label: "Dividend / distribution" },
  { value: "reserve_transfer", label: "Transfer to reserve" },
  { value: "opening_retained", label: "Retained earnings before the books started" },
] as const);
export type CapitalEntryType = (typeof CAPITAL_ENTRY_TYPES)[number]["value"];

export const INVESTOR_INSTRUMENTS = options([
  { value: "equity", label: "Equity shares" },
  { value: "preference", label: "Preference shares" },
  { value: "convertible", label: "Convertible note / CCD" },
  { value: "partner_capital", label: "Partner capital" },
  { value: "other", label: "Other" },
] as const);
export type InvestorInstrument = (typeof INVESTOR_INSTRUMENTS)[number]["value"];

/* Inventory: wastage */

export const WASTAGE_REASONS = options([
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "lost", label: "Lost" },
  { value: "defective", label: "Defective" },
  { value: "scrap", label: "Scrap / offcuts" },
  { value: "other", label: "Other" },
] as const);
export type WastageReason = (typeof WASTAGE_REASONS)[number]["value"];

/* Bank statements */

/** What a statement line becomes. "match" links it to a record that already exists. */
export const BANK_LINE_ACTIONS = options([
  { value: "match", label: "Already recorded" },
  { value: "expense", label: "New expense" },
  { value: "income", label: "New income" },
  { value: "capital", label: "Capital introduced" },
  { value: "drawing", label: "Owner drawing" },
  { value: "loan_received", label: "Loan received" },
  { value: "loan_payment", label: "Loan repayment" },
  { value: "transfer", label: "Transfer between own accounts" },
  { value: "ignore", label: "Ignore" },
] as const);
export type BankLineAction = (typeof BANK_LINE_ACTIONS)[number]["value"];

/* Analytics & Planning */

export const SCENARIO_TYPES = options([
  { value: "demand", label: "Demand change" },
  { value: "supply_delay", label: "Supply delay" },
  { value: "new_project", label: "New project" },
  { value: "price", label: "Purchase price change" },
  { value: "budget", label: "Budget planning" },
  { value: "manpower", label: "HR & manpower" },
  { value: "equipment", label: "Equipment requirement" },
] as const);
export type ScenarioType = (typeof SCENARIO_TYPES)[number]["value"];

export const SCENARIO_STATUSES = options([
  { value: "draft", label: "Draft" },
  { value: "saved", label: "Saved" },
  { value: "under_review", label: "Under review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
] as const);
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number]["value"];

/** Budget heads for budget planning scenarios. */
export const BUDGET_HEADS = options([
  { value: "materials", label: "Materials" },
  { value: "equipment", label: "Equipment" },
  { value: "labour", label: "Labour and manpower" },
  { value: "transport", label: "Transportation" },
  { value: "operations", label: "Operations" },
  { value: "administration", label: "Administration" },
  { value: "other", label: "Other expenses" },
] as const);
export type BudgetHead = (typeof BUDGET_HEADS)[number]["value"];
