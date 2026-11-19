import type { InventoryUnit, MovementType, StockStatus } from "@/lib/constants";

export type ItemCategoryRef = { id: string; name: string; color: string };

/** A row in the All Inventory table / card grid. */
export type ItemRow = {
  id: string;
  name: string;
  sku: string;
  unit: InventoryUnit;
  category: ItemCategoryRef | null;
  available: number;
  allocated: number;
  quantity: number;
  minStock: number;
  /** Weighted average cost per unit. */
  unitPrice: number;
  /** Stock on hand: available x unit price. */
  value: number;
  vendor: string | null;
  location: string | null;
  status: StockStatus;
  updatedAt: string;
};

/** Everything the edit form needs. Quantities are shown, never edited. */
export type ItemFormRecord = {
  id: string;
  name: string;
  sku: string;
  categoryId: string | null;
  unit: InventoryUnit;
  minStock: number;
  vendor: string | null;
  purchaseDate: string | null;
  description: string | null;
  location: string | null;
  updatedAt: string;
};

export type ItemMovementRow = {
  id: string;
  type: MovementType;
  quantity: number;
  availableDelta: number;
  project: { id: string; name: string; code: string; color: string } | null;
  /** Available stock right after this movement. */
  remaining: number;
  unitCost: number;
  totalCost: number;
  note: string | null;
  vendor: string | null;
  date: string;
  user: string | null;
};

export type ItemMovementSummary = {
  purchased: number;
  assigned: number;
  returned: number;
  /** Net of manual adjustments (signed). */
  adjusted: number;
  remaining: number;
  count: number;
};

export type ItemAllocationRow = {
  projectId: string;
  name: string;
  code: string;
  color: string;
  quantity: number;
  cost: number;
  lastAssignedAt: string;
};

export type ItemPurchasePoint = { id: string; date: string; unitCost: number; quantity: number; vendor: string | null };

export type ItemDetail = ItemRow &
  ItemFormRecord & {
    lastPurchasePrice: number | null;
    createdAt: string;
    movementCount: number;
    movements: ItemMovementRow[];
    summary: ItemMovementSummary;
    allocations: ItemAllocationRow[];
    purchases: ItemPurchasePoint[];
  };
