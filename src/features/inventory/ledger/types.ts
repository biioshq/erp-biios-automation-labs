import type { MovementType, ProjectStage, ProjectStatus, StockStatus } from "@/lib/constants";

/** An item as the operation forms need it (a superset of the shared item option). */
export type LedgerItem = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  available: number;
  allocated: number;
  quantity: number;
  minStock: number;
  /** Average cost per unit of the stock on hand. */
  unitPrice: number;
  /**
   * The not-yet-expensed lot as stored (null on an untracked item: then all stock is not expensed
   * yet). With these the assign form previews the split exactly as the ledger books it (stock-cost.ts).
   */
  unexpensedQty: number | null;
  unexpensedValue: number | null;
  lastPurchasePrice: number | null;
  vendor: string | null;
  status: StockStatus;
  /** The part's value or rating, to tell same-named parts apart in pickers. */
  variant: string | null;
};

/**
 * What the purchase form fills in when an item is picked, from that item's most recent purchase.
 * `rate` is the GST rate that purchase was taxed at (one of the standard rates), or null.
 */
export type LastPurchase = {
  date: string;
  vendor: string | null;
  gstin: string | null;
  hsnSac: string | null;
  rate: number | null;
};

export type LedgerProject = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
};

/** A row in "recent operations" under each form. */
export type RecentOperation = {
  id: string;
  type: MovementType;
  item: { id: string; name: string; sku: string; unit: string };
  quantity: number;
  project: { id: string; name: string; color: string } | null;
  stage: ProjectStage | null;
  unitCost: number;
  totalCost: number;
  vendor: string | null;
  date: string;
  createdAt: string;
  by: string | null;
};

/** Budget and spend of a project, for the assignment impact preview. */
export type ProjectImpact = {
  budget: number;
  spent: number;
  byStage: Record<string, number>;
  /** Spend leaves out salaries (member view), so the preview says so. */
  salariesHidden: boolean;
};

/** What a project holds of one item, with its assignments (latest first) to price a return. */
export type HeldItem = {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  held: number;
  cost: number;
  lots: { quantity: number; unitCost: number; stage: ProjectStage; assignedAt: string }[];
};

export type PurchaseResult = {
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
  available: number;
  status: StockStatus;
  /** The expense the purchase booked (none for a ₹0 purchase). */
  expenseNumber: string | null;
  expenseAmount: number;
};

export type AssignResult = {
  itemName: string;
  unit: string;
  quantity: number;
  projectName: string;
  expenseNumber: string | null;
  total: number;
  /** Of `total`: added to company expenses now (stock not expensed yet). */
  companyCost: number;
  /** Of `total`: moved into the project only, as it was expensed when bought. */
  countedAtPurchaseCost: number;
  available: number;
  status: StockStatus;
};

export type ReturnResult = {
  itemName: string;
  unit: string;
  quantity: number;
  projectName: string;
  credited: number;
  available: number;
};
