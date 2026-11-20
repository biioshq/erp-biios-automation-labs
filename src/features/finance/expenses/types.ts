import type { FileDTO } from "@/features/files/types";
import type { ExpenseSource, PaymentMethod, ProjectStage } from "@/lib/constants";

/** A row in the expenses table. */
export type ExpenseRow = {
  id: string;
  number: string;
  vendor: string;
  description: string | null;
  /** The stored value: a built-in (EXPENSE_CATEGORIES) or a custom category. */
  category: string;
  /** Its current name (renames show straight away), resolved on the server. */
  categoryLabel: string;
  amount: number;
  date: string;
  paymentMethod: PaymentMethod;
  project: { id: string; name: string; code: string; color: string } | null;
  stage: ProjectStage | null;
  source: ExpenseSource;
  gstin: string | null;
  invoiceNumber: string | null;
  totalTax: number;
  hasReceipt: boolean;
  /** The recurring schedule that posted this expense (source "recurring"). */
  recurring: { id: string; name: string } | null;
  /** The employee a salary expense is paid to. */
  employee: { id: string; name: string } | null;
};

export type ExpenseGst = {
  gstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  hsnSac: string | null;
  grandTotal: number;
};

/** Everything the detail drawer and the edit form need. */
export type ExpenseDetail = ExpenseRow & {
  vendorAddress: string | null;
  notes: string | null;
  gst: ExpenseGst | null;
  receipt: FileDTO | null;
  ocr: { overall: number; source: string; fields: Record<string, number> } | null;
  item: { id: string; name: string; sku: string } | null;
  quantity: number | null;
  unitCost: number | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseSummary = { count: number; total: number; tax: number };
