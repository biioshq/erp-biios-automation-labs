import type { StockStatus } from "@/lib/constants";

export type LowStockItem = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  status: Exclude<StockStatus, "in_stock">;
  available: number;
  allocated: number;
  quantity: number;
  minStock: number;
  /** Units to buy: enough to reach twice the minimum, never less than the minimum. */
  suggestedQuantity: number;
  /** Last purchase price, or the average cost when the item was never bought. */
  unitPrice: number;
  estimatedCost: number;
  vendor: string | null;
  category: { name: string; color: string } | null;
};

export type LowStockSummary = { low: number; out: number; estimatedCost: number };
