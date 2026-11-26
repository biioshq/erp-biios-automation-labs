import "server-only";

/**
 * Every collection in the ERP. Import models from here.
 *
 *   projects ─┬─< expenses >── files (receipt)
 *             ├─< income
 *             ├─< inventoryAllocations >── inventory (items) ──< inventoryMovements
 *             ├─< tasks
 *             └─< files (documents)
 *   inventory >── inventoryCategories
 *   employees ─< projectMembers >── projects
 *   recurringExpenses ─< expenses (posted occurrences); employees ── recurringExpenses (salary)
 *   expenseCategories (custom categories and renames of built-ins, matched by value on expenses / recurringExpenses)
 *   expenseDrafts (bills imported from Google Drive, waiting for review) >── files (receipt), ── expenses once saved
 *   notifications, reports (export log), counters (document numbers), user (Better Auth)
 *   roles (custom roles and the edited Member role; user.role holds the role key)
 *
 * Finance (balance sheet side; every balance is computed in src/server/accounting, never stored):
 *   bankAccounts (cash and bank, opening balances) ─< expenses / income / payments (account)
 *   accountTransfers (between own accounts), bankStatements ─< bankTransactions (lines, linked to the record each became)
 *   invoices ─< income (invoice): receivables
 *   fixedAssets (register, depreciation, maintenance) ── expenses (funding.expense / capitalAsset)
 *   investments, liabilities (loans and other obligations, with repayments) ── expenses (interest)
 *   equityHolders ─< capitalEntries (capital, drawings, dividends, reserves)
 *   financeGroups (subgroups admins add under the built-in asset, liability and equity groups)
 * Analytics: scenarios (hypothetical only), forecastSnapshots (forecasts kept to compare with actuals)
 * HR: attendance (one mark per employee per day) >── employees, hrHolidays, hrSettings (attendance rules),
 *   payrollAdjustments (bonus / deduction per person per month), payrollRuns (finalised months). None of these
 *   post to Expenses: salary expenses still come from the salary schedules in recurringExpenses.
 *
 * Money is stored in rupees as numbers rounded to paise (see round2).
 * Project spend, budget usage and inventory value are always computed from
 * expenses / items, never stored twice.
 */
export { Counter } from "./counter";
export { User, type UserDoc } from "./user";
export { Role, type RoleDoc } from "./role";
export { FileModel, type FileDoc, FILE_KINDS, type FileKind } from "./file";
export { Project, type ProjectDoc } from "./project";
export { Expense, type ExpenseDoc } from "./expense";
export { Income, type IncomeDoc } from "./income";
export { InventoryCategory, type InventoryCategoryDoc } from "./inventory-category";
export { InventoryItem, type InventoryItemDoc } from "./inventory-item";
export { InventoryMovement, type InventoryMovementDoc } from "./inventory-movement";
export { InventoryAllocation, type InventoryAllocationDoc } from "./inventory-allocation";
export { Task, type TaskDoc } from "./task";
export { Notification, type NotificationDoc, NOTIFICATION_TYPES, type NotificationType } from "./notification";
export { Report, type ReportDoc } from "./report";
export { Employee, type EmployeeDoc } from "./employee";
export { ProjectMember, type ProjectMemberDoc } from "./project-member";
export { RecurringExpense, type RecurringExpenseDoc } from "./recurring-expense";
export { ExpenseCategorySetting, type ExpenseCategorySettingDoc } from "./expense-category";
export { ExpenseDraft, type ExpenseDraftDoc, EXPENSE_DRAFT_STATUSES, type ExpenseDraftStatus } from "./expense-draft";
export { BankAccount, type BankAccountDoc } from "./bank-account";
export { AccountTransfer, type AccountTransferDoc } from "./account-transfer";
export { BankStatement, type BankStatementDoc, BankTransaction, type BankTransactionDoc } from "./bank-statement";
export { BankPartyRule, type BankPartyRuleDoc } from "./bank-party-rule";
export { FinanceGroup, type FinanceGroupDoc } from "./finance-group";
export { FixedAsset, type FixedAssetDoc } from "./fixed-asset";
export { Investment, type InvestmentDoc } from "./investment";
export { Liability, type LiabilityDoc } from "./liability";
export { EquityHolder, type EquityHolderDoc, CapitalEntry, type CapitalEntryDoc } from "./equity";
export { Invoice, type InvoiceDoc } from "./invoice";
export { Scenario, type ScenarioDoc, ForecastSnapshot, type ForecastSnapshotDoc } from "./scenario";
export { Attendance, type AttendanceDoc } from "./attendance";
export { HrHoliday, type HrHolidayDoc } from "./hr-holiday";
export { HrSettings, type HrSettingsDoc } from "./hr-settings";
export { PayrollAdjustment, type PayrollAdjustmentDoc, PayrollRun, type PayrollRunDoc } from "./payroll";
export { CompanyProfile, type CompanyProfileDoc } from "./company-profile";
export { AuditLog, type AuditLogDoc } from "./audit-log";
