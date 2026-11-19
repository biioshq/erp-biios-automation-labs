import { cn } from "@/lib/utils";
import { getStockStatus, stockLevelPercent } from "@/lib/stock-status";

const FILL = { in_stock: "bg-success", low_stock: "bg-warning", out_of_stock: "bg-danger" } as const;

/** Stock level bar, coloured by status. Fills against twice the minimum stock level. */
export function StockLevelBar({
  available,
  minStock,
  quantity,
  className,
  showMinMarker = true,
}: {
  available: number;
  minStock: number;
  quantity: number;
  className?: string;
  showMinMarker?: boolean;
}) {
  const status = getStockStatus(available, minStock);
  const percent = stockLevelPercent(available, minStock, quantity);
  return (
    <div
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Stock level ${percent}%`}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", FILL[status])}
        style={{ width: `${Math.max(status === "out_of_stock" ? 0 : 3, percent)}%` }}
      />
      {showMinMarker && minStock > 0 ? (
        <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" title={`Minimum stock: ${minStock}`} aria-hidden />
      ) : null}
    </div>
  );
}
