import type { FileDTO } from "@/features/files/types";
import type { LiabilityKind, LiabilitySource, LiabilityStatus, PaymentMethod, PaymentStatus } from "@/lib/constants";
import type { StatementLine } from "@/lib/accounting";

/** One loan or other obligation in a list. Balances come from liabilityState (src/server/finance/summaries.ts). */
export type LiabilityListRow = {
  id: string;
  code: string;
  name: string;
  kind: LiabilityKind;
  group: string;
  groupLabel: string;
  groupPath: string;
  current: boolean;
  lender: string;
  originalAmount: number;
  principalPaid: number;
  interestPaid: number;
  outstanding: number;
  date: string;
  dueDate: string | null;
  interestRate: number | null;
  tenureMonths: number | null;
  installment: number | null;
  status: LiabilityStatus;
  lastPaymentDate: string | null;
  paymentCount: number;
  /** The next planned instalment, when the loan has a rate, tenure and instalment. */
  nextInstallment: { date: string; amount: number; late: boolean } | null;
};

export type RepaymentRow = {
  id: string;
  date: string;
  principal: number;
  interest: number;
  total: number;
  paymentMethod: PaymentMethod;
  account: string | null;
  reference: string | null;
  note: string | null;
  /** The interest expense this repayment created. */
  expense: { id: string; number: string } | null;
  fromBankStatement: boolean;
  /** The statement line it is matched to (/finance/bank-statements?line=<id>). */
  bankTransactionId: string | null;
};

export type LiabilityDetail = LiabilityListRow & {
  source: {
    mode: LiabilitySource;
    accountId: string | null;
    accountName: string | null;
    paymentMethod: PaymentMethod | null;
    /** Source "accrued": the expense category the cost was booked to, with its label. */
    category: string | null;
    categoryLabel: string | null;
  };
  reference: string | null;
  notes: string | null;
  payments: RepaymentRow[];
  documents: FileDTO[];
  fromBankStatement: boolean;
  /** The statement line it came from or was matched to. */
  bankTransactionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A section of the Current or Non-current page: one group under the side, with its subgroups. */
export type GroupSection = {
  key: string;
  label: string;
  description: string | null;
  builtIn: boolean;
  /** Computed from other records (accounts payable, advances, group company): shown, not edited here. */
  computed: boolean;
  /** Takes records typed in here. */
  entry: boolean;
  /** Its balance-sheet amount, so the page agrees with the balance sheet. */
  amount: number;
  /** Computed lines inside it (GST payable under Taxes payable), with where they come from. */
  computedLines: (StatementLine & { href: string | null; sourceLabel: string | null; note: string | null })[];
  /** The groups records can be filed under in this section (itself and its subgroups), for the add form. */
  groupKeys: string[];
  subgroups: { key: string; label: string; depth: number; outstanding: number; count: number }[];
  rows: LiabilityListRow[];
  /** Before filters. */
  totalCount: number;
  outstanding: number;
};

/** A row of the accounts payable table (an unpaid or part-paid expense). */
export type PayableListRow = {
  id: string;
  number: string;
  vendor: string;
  category: string;
  categoryLabel: string;
  project: { id: string; name: string } | null;
  date: string;
  dueDate: string | null;
  amount: number;
  paid: number;
  outstanding: number;
  status: PaymentStatus;
};

export type BillPaymentRow = {
  key: string;
  expenseId: string;
  number: string;
  vendor: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
};

/** One item due: a loan, another obligation (TDS, salaries due) or a supplier bill. */
export type DueItem = {
  key: string;
  kind: "loan" | "other" | "bill";
  label: string;
  sub: string;
  href: string;
  dueDate: string | null;
  amount: number;
  status: "overdue" | "upcoming";
};
