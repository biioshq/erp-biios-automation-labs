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
  /** Weighted average cost: what assignments are costed at. */
  unitPrice: number;
  lastPurchasePrice: number | null;
  vendor: string | null;
  status: StockStatus;
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
};

export type AssignResult = {
  itemName: string;
  unit: string;
  quantity: number;
  projectName: string;
  expenseNumber: string | null;
  total: number;
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
