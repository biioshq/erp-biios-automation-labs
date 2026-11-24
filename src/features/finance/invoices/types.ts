import type { FileDTO } from "@/features/files/types";
import type { IncomeCategory, PaymentMethod } from "@/lib/constants";
import type { InvoiceListStatus } from "./schemas";

export type ProjectRef = { id: string; name: string; code: string; color: string };

/** A row in the invoice list: the invoice with what was received against it (computed). */
export type InvoiceRow = {
  id: string;
  number: string;
  client: string;
  project: ProjectRef | null;
  date: string;
  dueDate: string | null;
  total: number;
  received: number;
  outstanding: number;
  /** Received above the total: held in the books as a customer advance (0 when not overpaid). */
  credit: number;
  /** Payment status from invoiceBalances, or "cancelled". */
  status: InvoiceListStatus;
  hasFile: boolean;
};

export type InvoiceLine = {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  gstRate: number;
  hsnSac: string | null;
};

/** An income record linked to an invoice. */
export type InvoiceReceipt = {
  id: string;
  number: string;
  client: string;
  category: IncomeCategory;
  amount: number;
  date: string;
  paymentMethod: PaymentMethod;
  account: { id: string; name: string } | null;
  reference: string | null;
};

/** Everything the detail drawer and the edit form need. */
export type InvoiceDetail = InvoiceRow & {
  clientGstin: string | null;
  interState: boolean;
  lines: InvoiceLine[];
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  notes: string | null;
  file: FileDTO | null;
  receipts: InvoiceReceipt[];
  lastReceivedOn: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** An open invoice offered when an income record is linked to one. */
export type OpenInvoiceOption = {
  id: string;
  number: string;
  client: string;
  date: string;
  dueDate: string | null;
  total: number;
  /** Outstanding before the receipt being edited (its own amount is added back). */
  outstanding: number;
  status: InvoiceListStatus;
  project: { id: string; name: string } | null;
};

/** A receipt not linked to any invoice, offered by "Apply advance". */
export type UnlinkedReceipt = {
  id: string;
  number: string;
  category: IncomeCategory;
  amount: number;
  date: string;
  reference: string | null;
  project: { id: string; name: string } | null;
};

/** A row in the "Payments received" tab: a receipt against an invoice. */
export type InvoicePaymentRow = InvoiceReceipt & {
  invoice: { id: string; number: string; total: number; outstanding: number; status: InvoiceListStatus } | null;
  project: { id: string; name: string; color: string } | null;
};

export type InvoiceListSummary = {
  count: number;
  invoiced: number;
  received: number;
  outstanding: number;
};
