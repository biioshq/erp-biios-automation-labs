import type { FileDTO } from "@/features/files/types";
import type { IncomeCategory, PaymentMethod } from "@/lib/constants";

/** A row in the income table. */
export type IncomeRow = {
  id: string;
  number: string;
  client: string;
  category: IncomeCategory;
  amount: number;
  date: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  project: { id: string; name: string; code: string; color: string } | null;
  hasReceipt: boolean;
  /** The invoice this receipt settles. */
  invoice: { id: string; number: string } | null;
  /** The bank or cash account it came into; null = the default for its method. */
  account: { id: string; name: string } | null;
};

/** Everything the detail drawer and the edit form need. */
export type IncomeDetail = IncomeRow & {
  notes: string | null;
  receipt: FileDTO | null;
  /** Set when the receipt came from or was matched to a bank statement line. */
  fromBankStatement: boolean;
  /** That statement line (/finance/bank-statements?line=<id>), for admins. */
  bankTransactionId: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type IncomeSummary = { count: number; total: number };
