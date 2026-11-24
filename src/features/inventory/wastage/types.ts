import type { Department, ProjectStage, WastageReason } from "@/lib/constants";

/** A row in the wastage list. */
export type WastageRow = {
  id: string;
  date: string;
  item: { id: string; name: string; sku: string; unit: string };
  quantity: number;
  reason: WastageReason;
  from: "storage" | "project";
  project: { id: string; name: string; color: string } | null;
  stage: ProjectStage | null;
  department: Department | null;
  location: string | null;
  responsible: string | null;
  /** Value written off, at cost. */
  value: number;
  /** The company expense booked for stock that was never expensed (storage only). */
  expense: { id: string; number: string; amount: number } | null;
  note: string | null;
  by: string | null;
};

export type WastageTotals = { units: number; value: number; count: number };

/** Totals for the rows in view, split by where the stock was. */
export type WastageSummary = {
  all: WastageTotals;
  storage: WastageTotals;
  project: WastageTotals;
  /** Of the storage value: booked now as a company expense (cost never expensed before). */
  expensed: number;
};

export type WastageResult = {
  itemName: string;
  unit: string;
  quantity: number;
  value: number;
  from: "storage" | "project";
  projectName: string | null;
  expenseNumber: string | null;
  expenseAmount: number;
  available: number;
};
