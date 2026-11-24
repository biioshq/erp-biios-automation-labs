import type { ProjectStage, ProjectStatus, StockStatus } from "@/lib/constants";

/** Inventory valuation page data. Client-safe: plain values only. */

export type StorageRow = {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  quantity: number;
  unit: string;
  minStock: number;
  /** Weighted average cost per unit of the stock on hand. */
  unitPrice: number;
  value: number;
  location: string | null;
  /** Last purchase (stock in) date, "yyyy-mm-dd". */
  lastIn: string | null;
  status: StockStatus;
};

export type InUseRow = {
  /** The assignment (allocation) id. */
  id: string;
  itemId: string;
  name: string;
  sku: string;
  category: string | null;
  /** Units still on the project and not wasted. */
  quantity: number;
  wasted: number;
  unit: string;
  /** Cost per unit when it was assigned. */
  unitCost: number;
  value: number;
  project: { id: string; name: string; color: string; status: ProjectStatus } | null;
  stage: ProjectStage | null;
  assignedAt: string;
};

export type ProjectInUse = { id: string; name: string; color: string; status: ProjectStatus; lines: number; value: number };

export type WastedRow = {
  id: string;
  itemId: string;
  name: string;
  sku: string;
  category: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  value: number;
  from: "storage" | "project";
  /** Project name for stock wasted in use, otherwise the storage location. */
  where: string | null;
  projectId: string | null;
  department: string | null;
  responsible: string | null;
  reason: string;
  date: string;
  note: string | null;
};

/** Units and value of one flow in the period. Values are null where the books carry none (stock in use). */
export type Flow = { quantity: number; value: number };

export type PeriodSummary = {
  from: string;
  to: string;
  opening: Flow;
  purchases: Flow;
  issued: Flow;
  returned: Flow;
  /** Written off from storage. */
  wastage: Flow;
  /** Count corrections and other changes to stock in storage, signed. */
  adjustments: Flow;
  closing: Flow;
  /** Wasted while in use on a project: already charged to the project, so storage is unchanged. */
  wastedInUse: Flow;
  /** Moved straight from one project to another: never back in storage, so neither issued nor returned. */
  movedBetweenProjects: Flow;
  movementCount: number;
};

export type PeriodItemRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  opening: number;
  purchased: number;
  purchasedValue: number;
  issued: number;
  issuedValue: number;
  returned: number;
  wasted: number;
  wastedValue: number;
  adjusted: number;
  closing: number;
};

export type AlertRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  available: number;
  minStock: number;
  leadTimeDays: number | null;
  level: "out" | "below_min" | "runs_out";
  reasons: string[];
  daysOfCover: number | null;
  orderBy: string | null;
  suggestedQty: number | null;
};

export type InventoryValuation = {
  asOf: string;
  storage: { rows: StorageRow[]; quantity: number; value: number; items: number; outOfStock: number };
  inUse: { rows: InUseRow[]; quantity: number; value: number; projects: ProjectInUse[] };
  wasted: { rows: WastedRow[]; quantity: number; value: number; yearValue: number; yearLabel: string };
  /** Inventory on the balance sheet today (the accounting engine's Inventory account). */
  bookValue: number;
  period: PeriodSummary;
  periodItems: PeriodItemRow[];
  alerts: AlertRow[];
};
