import type { MovementType, ProjectStage } from "@/lib/constants";

/** A row in the stock movement table. */
export type MovementRow = {
  id: string;
  date: string;
  type: MovementType;
  item: { id: string; name: string; sku: string; unit: string };
  /** Units moved, positive. */
  quantity: number;
  /** Signed change to available stock: + in, - out. */
  availableDelta: number;
  project: { id: string; name: string; code: string; color: string } | null;
  stage: ProjectStage | null;
  unitCost: number;
  totalCost: number;
  vendor: string | null;
  balance: { available: number; allocated: number };
  by: string | null;
  note: string | null;
};

export type MovementTotals = { units: number; value: number; count: number };

/** Totals for the filtered range, one per kind of movement. */
export type MovementSummary = {
  purchase: MovementTotals;
  assign: MovementTotals;
  return: MovementTotals;
  /** Net change in available units (adjustments can go either way). */
  adjustment: MovementTotals & { net: number };
  count: number;
};
