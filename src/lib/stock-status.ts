import type { StockStatus } from "./constants";

/**
 * Stock health from the available quantity. Client-safe, and the only place
 * these rules live, so badges, filters, notifications and reports agree.
 *
 *  - Out of Stock: nothing available. Cannot be assigned to projects.
 *  - Low Stock:    available ≤ minimum stock level (and above zero).
 *  - In Stock:     available > minimum stock level.
 */
export function getStockStatus(available: number, minStock: number): StockStatus {
  if (available <= 0) return "out_of_stock";
  if (available <= minStock) return "low_stock";
  return "in_stock";
}

export const STOCK_STATUS_META: Record<
  StockStatus,
  { label: string; tone: "success" | "warning" | "danger"; description: string }
> = {
  in_stock: { label: "In Stock", tone: "success", description: "Healthy stock above the minimum level." },
  low_stock: {
    label: "Low Stock",
    tone: "warning",
    description: "At or below the minimum level. Purchase new stock soon.",
  },
  out_of_stock: {
    label: "Out of Stock",
    tone: "danger",
    description: "Nothing available. Purchase stock before it can be assigned to a project.",
  },
};

/**
 * Fill level for the stock progress bar: available against a healthy target
 * (twice the minimum, or the total held when no minimum is set).
 */
export function stockLevelPercent(available: number, minStock: number, totalQuantity: number): number {
  const target = minStock > 0 ? minStock * 2 : Math.max(totalQuantity, 1);
  return Math.max(0, Math.min(100, Math.round((available / target) * 100)));
}

/** Mongo filter for a stock status (`available` vs `minStock`). Server-side use. */
export function stockStatusFilter(status: StockStatus): Record<string, unknown> {
  switch (status) {
    case "out_of_stock":
      return { available: { $lte: 0 } };
    case "low_stock":
      return { available: { $gt: 0 }, $expr: { $lte: ["$available", "$minStock"] } };
    case "in_stock":
      return { $expr: { $gt: ["$available", "$minStock"] }, available: { $gt: 0 } };
  }
}
