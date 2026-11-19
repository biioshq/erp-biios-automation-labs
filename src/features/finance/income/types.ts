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
};

/** Everything the detail drawer and the edit form need. */
export type IncomeDetail = IncomeRow & {
  notes: string | null;
  receipt: FileDTO | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type IncomeSummary = { count: number; total: number };
