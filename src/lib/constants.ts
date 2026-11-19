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
  /** Generated expenses for stock taken from inventory (already paid at purchase). */
  { value: "stock", label: "From stock" },
  { value: "other", label: "Other" },
] as const);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

/** Where an expense came from. Generated expenses are edited through their source, not by hand. */
export const EXPENSE_SOURCES = options([
  { value: "manual", label: "Manual" },
  { value: "inventory_assignment", label: "Inventory assignment" },
  { value: "recurring", label: "Recurring" },
] as const);
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number]["value"];

export const INCOME_CATEGORIES = options([
  { value: "project_payment", label: "Project payment" },
  { value: "advance", label: "Advance" },
  { value: "retainer", label: "Retainer" },
  { value: "product_sale", label: "Product sale" },
  { value: "grant", label: "Grant" },
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
