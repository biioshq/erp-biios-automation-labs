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
 *   notifications, reports (export log), counters (document numbers), user (Better Auth)
 *
 * Money is stored in rupees as numbers rounded to paise (see round2).
 * Project spend, budget usage and inventory value are always computed from
 * expenses / items, never stored twice.
 */
export { Counter } from "./counter";
export { User, type UserDoc } from "./user";
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
