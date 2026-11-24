import type { FileDTO } from "@/features/files/types";
import type { InvestmentType } from "@/lib/constants";

export type InvestmentRow = {
  id: string;
  name: string;
  type: InvestmentType;
  group: string;
  groupLabel: string;
  groupPath: string;
  institution: string | null;
  reference: string | null;
  purchaseDate: string;
  /** What was paid: the figure the balance sheet carries. */
  amount: number;
  /** Paid from; null when it was held before the books started. */
  account: { id: string; name: string } | null;
  currentValue: number | null;
  valuedOn: string | null;
  interestRate: number | null;
  maturityDate: string | null;
  /** Current value less cost, only when a value was recorded and it is still held. */
  unrealised: number | null;
  redemption: { date: string; amount: number; account: { id: string; name: string } | null; notes: string | null; gain: number } | null;
  /** False once redeemed: listed, but not counted in what is held. */
  held: boolean;
  archived: boolean;
};

export type InvestmentDetail = InvestmentRow & {
  notes: string | null;
  documents: FileDTO[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestmentTotals = {
  count: number;
  cost: number;
  /** Only investments with a recorded current value count here. */
  valuedCount: number;
  valuedCost: number;
  value: number;
  redeemedCount: number;
};

export type InvestmentGroupNode = {
  key: string;
  label: string;
  depth: number;
  builtIn: boolean;
  rows: InvestmentRow[];
  children: InvestmentGroupNode[];
  totals: InvestmentTotals;
};

export type InvestmentList = {
  rows: InvestmentRow[];
  tree: InvestmentGroupNode[];
  totals: InvestmentTotals;
  filtered: boolean;
};
