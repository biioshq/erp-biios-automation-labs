import type { StockStatus } from "@/lib/constants";

/** Why an item is on the reorder list (src/server/analytics/core.ts lookAheadAlerts). */
export type AlertLevel = "out" | "below_min" | "runs_out";

/** One item to reorder, with how long its stock lasts at the recent rate of use. */
export type LowStockItem = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  status: StockStatus;
  level: AlertLevel;
  /** In plain words, one per rule the item meets. */
  reasons: string[];
  available: number;
  allocated: number;
  quantity: number;
  minStock: number;
  /** Units used per day over the window (issued less returned); null without recorded use. */
  perDay: number | null;
  daysOfCover: number | null;
  stockoutDate: string | null;
  /** Last day to order so it arrives before the stockout (stockout less lead time). */
  orderBy: string | null;
  leadTimeDays: number | null;
  /** Units to cover lead time plus a week of use, plus the minimum level; null when that is nothing. */
  suggestedQty: number | null;
  /** Last purchase price, or the average cost when the item was never bought. */
  unitPrice: number;
  /** suggestedQty × unitPrice; null without a suggestion. */
  estimatedCost: number | null;
  vendor: string | null;
  category: { name: string; color: string } | null;
};

export type LowStockSummary = {
  out: number;
  belowMin: number;
  runsOut: number;
  /** Items whose order-by date is today or already past. */
  orderNow: number;
  estimatedCost: number;
  /** Days of history the rate of use is taken over. */
  windowDays: number;
  /** Days added to each item's lead time: alerts start this long before an order must go out. */
  bufferDays: number;
};
