import type { FileDTO } from "@/features/files/types";
import type { Department, ExpenseNature, ExpenseSource, PaymentMethod, PaymentStatus, ProjectStage } from "@/lib/constants";

/** A payment status, or "stock" for generated stock assignments, which move no money. */
export type ExpensePaymentStatus = PaymentStatus | "stock";

/** Paid and outstanding as of today (paymentState in src/lib/payments.ts). */
export type ExpensePaymentSummary = {
  status: ExpensePaymentStatus;
  paid: number;
  outstanding: number;
  /** When the unpaid part is due (the due date, or the expense date); null when nothing is owed. */
  dueOn: string | null;
  /** True when payments are recorded one by one; false for the old meaning (paid on its date, or On credit). */
  explicit: boolean;
  /** The day of the latest payment (the expense date for one paid in full on its date); null when nothing is paid. */
  lastPaidOn?: string | null;
  /** How the latest payment was made: for a bill bought "On credit" and paid later, the method actually used. */
  lastMethod?: PaymentMethod | null;
};

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
  /**
   * Stock used on a project that was expensed when it was bought: a project cost only. Listed, but
   * left out of company totals (the list totals, dashboard and reports).
   */
  countedAtPurchase: boolean;
  gstin: string | null;
  invoiceNumber: string | null;
  totalTax: number;
  hasReceipt: boolean;
  /** The recurring schedule that posted this expense (source "recurring"). */
  recurring: { id: string; name: string } | null;
  /** The employee a salary expense is paid to. */
  employee: { id: string; name: string } | null;
  department: Department | null;
  /** Direct (on a project, or a direct category) or indirect (overhead). */
  nature: ExpenseNature;
  payment: ExpensePaymentSummary;
  /** The due date as saved (no fallback to the expense date); null when none was given. */
  dueDate?: string | null;
  /** Came from, or was paid through, a bank statement line. */
  fromBank?: boolean;
};

/** One payment recorded against an expense. */
export type ExpensePaymentRecord = {
  id: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  account: { id: string; name: string } | null;
  reference: string | null;
  note: string | null;
  /** Matched to a bank statement line: removed through Bank statements, not here. */
  fromBankStatement: boolean;
  /** The statement line it is matched to (/finance/bank-statements?line=<id>), for admins. */
  bankTransactionId: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string | null;
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
  dueDate: string | null;
  /** "Paid from", for an expense paid in full on its date. */
  account: { id: string; name: string } | null;
  /** Payments recorded one by one, oldest first. Empty when `payment.explicit` is false. */
  payments: ExpensePaymentRecord[];
  prepaid: { from: string; to: string } | null;
  /** The loan whose interest this is (source "liability_interest"). */
  liability: { id: string; name: string } | null;
  /** The fixed asset this expense paid for. */
  capitalAsset: { id: string; name: string; code: string; purchaseCost: number } | null;
  /** Created from, or matched to, a bank statement line as paid on its date: its payment and amount stay as the line says. */
  bankMatched: boolean;
  /**
   * The statement line the expense itself came from or was matched to, loan interest included
   * (the repayment's line). Payments carry their own.
   */
  bankTransactionId: string | null;
};

/**
 * `count` is every listed row. `total` and `tax` always leave out rows counted at purchase (stock
 * expensed when it was bought), so they never count it twice.
 */
export type ExpenseSummary = {
  count: number;
  total: number;
  tax: number;
  /** Of `total`, what is paid and what is still owed (paid + outstanding = total), same rows. */
  paid?: number;
  outstanding?: number;
  /** Rows with something still owed. */
  outstandingCount?: number;
};
