/**
 * The audit trail's vocabulary: what was done, to what, and where the change came from. Client-safe
 * (the viewer and the History sections use the labels). Stored values are never renamed; new ones
 * may be added.
 */

const options = <const T extends readonly { value: string; label: string }[]>(list: T) => list;

export const AUDIT_ACTIONS = options([
  { value: "created", label: "Created" },
  { value: "imported", label: "Imported" },
  { value: "edited", label: "Edited" },
  { value: "categorised", label: "Reclassified" },
  { value: "deleted", label: "Deleted" },
  { value: "paid", label: "Paid" },
  { value: "payment_removed", label: "Payment removed" },
  { value: "matched", label: "Matched to bank" },
  { value: "unmatched", label: "Unmatched from bank" },
  { value: "linked", label: "Linked" },
  { value: "unlinked", label: "Unlinked" },
  { value: "cancelled", label: "Cancelled" },
  { value: "restored", label: "Restored" },
  { value: "rule_changed", label: "Rule changed" },
]);
export type AuditAction = (typeof AUDIT_ACTIONS)[number]["value"];

export const AUDIT_SOURCES = options([
  { value: "manual", label: "By hand" },
  { value: "bank_statement", label: "Bank statement" },
  { value: "csv_import", label: "CSV import" },
  { value: "drive", label: "Google Drive" },
  { value: "recurring", label: "Recurring schedule" },
  { value: "system", label: "System" },
]);
export type AuditSource = (typeof AUDIT_SOURCES)[number]["value"];

export const AUDIT_ENTITY_TYPES = options([
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "invoice", label: "Invoice" },
  { value: "capital_entry", label: "Capital entry" },
  { value: "liability", label: "Loan" },
  { value: "account_transfer", label: "Transfer" },
  { value: "bank_party_rule", label: "Remembered party" },
  { value: "expense_category", label: "Expense category" },
]);
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]["value"];

export const auditValues = <T extends readonly { value: string }[]>(list: T) => list.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]];

export function auditLabel(list: readonly { value: string; label: string }[], value: string | null | undefined): string {
  return list.find((o) => o.value === value)?.label ?? (value ? value.replace(/_/g, " ") : "");
}

/** How a changed field is shown: its name and how to read its value. */
export type AuditFieldKind = "text" | "money" | "date" | "bool" | "category" | "incomeCategory" | "project" | "account" | "stage" | "method" | "department";

export const AUDIT_FIELDS: Record<string, { label: string; kind: AuditFieldKind }> = {
  number: { label: "Number", kind: "text" },
  vendor: { label: "Vendor", kind: "text" },
  vendorAddress: { label: "Vendor address", kind: "text" },
  client: { label: "Customer", kind: "text" },
  clientGstin: { label: "Customer GSTIN", kind: "text" },
  description: { label: "Description", kind: "text" },
  amount: { label: "Amount", kind: "money" },
  total: { label: "Total", kind: "money" },
  taxableAmount: { label: "Taxable value", kind: "money" },
  tax: { label: "GST", kind: "money" },
  date: { label: "Date", kind: "date" },
  dueDate: { label: "Due date", kind: "date" },
  category: { label: "Category", kind: "category" },
  incomeCategory: { label: "Category", kind: "incomeCategory" },
  project: { label: "Project", kind: "project" },
  stage: { label: "Stage", kind: "stage" },
  paymentMethod: { label: "Payment mode", kind: "method" },
  account: { label: "Account", kind: "account" },
  department: { label: "Department", kind: "department" },
  reference: { label: "Reference", kind: "text" },
  notes: { label: "Notes", kind: "text" },
  gstin: { label: "GSTIN", kind: "text" },
  invoiceNumber: { label: "Vendor invoice no.", kind: "text" },
  invoice: { label: "Invoice", kind: "text" },
  receipt: { label: "Receipt file", kind: "bool" },
  file: { label: "Invoice file", kind: "bool" },
  prepaidFrom: { label: "Prepaid from", kind: "date" },
  prepaidTo: { label: "Prepaid to", kind: "date" },
  interState: { label: "Inter-state", kind: "bool" },
  lines: { label: "Lines", kind: "text" },
  status: { label: "Status", kind: "text" },
  paid: { label: "Paid", kind: "money" },
  paidAmount: { label: "Payment", kind: "money" },
  paidOn: { label: "Paid on", kind: "date" },
  bankLine: { label: "Bank line", kind: "text" },
  label: { label: "Name", kind: "text" },
  hidden: { label: "Hidden", kind: "bool" },
  nature: { label: "Type", kind: "text" },
  party: { label: "Stands for", kind: "text" },
};

/** One changed field as the viewer shows it, already formatted on the server. */
export type AuditChangeView = { field: string; label: string; from: string | null; to: string | null };

/** One audit entry as the viewer and the History sections show it. */
export type AuditRow = {
  id: string;
  at: string;
  actor: string;
  action: AuditAction;
  actionLabel: string;
  source: AuditSource;
  sourceLabel: string;
  entityType: AuditEntityType;
  entityTypeLabel: string;
  entityId: string;
  entityLabel: string;
  href: string | null;
  changes: AuditChangeView[];
  note: string | null;
};

export const AUDIT_FILTER_KEYS = ["type", "action", "actor", "source"] as const;
