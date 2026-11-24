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
  /** Why it is on the reorder list, in plain words. */
  reason: string | null;
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
  /** Items on the reorder list (low, out, or running out within lead time plus a week). */
  attentionTotal: number;
  /** The same list by reason, so the banner's breakdown adds up to its total. */
  attentionLevels: AttentionLevels;
  recent: RecentMovement[];
};

/** Items on the reorder list by why they are there (src/server/analytics/core.ts lookAheadAlerts). */
export type AttentionLevels = { out: number; belowMin: number; runsOut: number };

export type StockPeriodKey = "fy" | "last-fy" | "month" | "last-month";

type WastedTotals = { units: number; value: number; count: number };

/**
 * Stock value at the start and end of a period and what moved it, from the books' Inventory
 * account. All amounts are positive; issued and wasted reduce stock, adjusted is signed.
 */
export type StockRollForward = {
  from: string;
  to: string;
  opening: number;
  /** Stock purchases booked in the period (their stock cost, without GST input credit). */
  purchased: number;
  /** Stock entered as already on hand (opening stock), not bought in the period. */
  enteredOnHand: number;
  /** Stock issued to projects. */
  issued: number;
  returned: number;
  /** Count corrections, signed: + found, - removed. */
  adjusted: number;
  /** Written off from storage. */
  wasted: number;
  /** Anything else posted to Inventory; normally 0. */
  other: number;
  closing: number;
};

export type StockPosition = {
  period: StockPeriodKey;
  /** In the stock room, at the weighted average cost. */
  storage: { value: number; items: number };
  /** Issued to projects and not wasted, at the cost each was assigned at. */
  inUse: { value: number; units: number };
  wasted: { financialYear: WastedTotals; allTime: WastedTotals; fyLabel: string };
  roll: StockRollForward;
  today: string;
};
