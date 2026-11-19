import type { InventoryUnit, MovementType, StockStatus } from "@/lib/constants";

export type DashboardSnapshot = {
  items: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  value: number;
  allocatedValue: number;
};

export type CategoryValue = { name: string; color: string; value: number; items: number };

export type WeeklyMovement = { label: string; range: string; purchased: number; assigned: number; returned: number };

export type AttentionItem = {
  id: string;
  name: string;
  sku: string;
  unit: InventoryUnit;
  available: number;
  minStock: number;
  status: StockStatus;
  quantity: number;
};

export type RecentMovement = {
  id: string;
  type: MovementType;
  quantity: number;
  availableDelta: number;
  date: string;
  item: { id: string; name: string; sku: string; unit: InventoryUnit } | null;
  project: { id: string; name: string; color: string } | null;
  user: string | null;
};

export type InventoryDashboardData = {
  snapshot: DashboardSnapshot;
  valueByCategory: CategoryValue[];
  weekly: WeeklyMovement[];
  attention: AttentionItem[];
  recent: RecentMovement[];
};
