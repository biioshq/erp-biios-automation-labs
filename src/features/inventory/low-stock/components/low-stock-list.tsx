import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { StockLevelBar } from "@/components/shared/stock-level-bar";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LowStockItem } from "../types";

/** One card per item that needs restocking. The primary action opens the purchase form for it. */
export function LowStockList({ items }: { items: LowStockItem[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
      {items.map((item, index) => (
        <li
          key={item.id}
          className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300"
          style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
        >
          <article
            className={cn(
              "flex h-full flex-col gap-4 rounded-xl border bg-card p-4 shadow-card sm:p-5",
              item.status === "out_of_stock" ? "border-danger/30" : "border-warning/25",
            )}
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/inventory/items/${item.id}`} className="block truncate text-[15px] font-semibold tracking-tight hover:underline">
                  {item.name}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-mono">{item.sku}</span>
                  {item.category ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ background: item.category.color }} />
                      {item.category.name}
                    </span>
                  ) : null}
                </p>
              </div>
              <StockStatusBadge status={item.status} />
            </header>

            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="tabular">
                  <span className="text-lg font-semibold">{formatNumber(item.available)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    of {formatNumber(item.minStock)} {item.unit} minimum
                  </span>
                </span>
                <span className="tabular text-xs text-muted-foreground">
                  {formatNumber(item.allocated)} {item.unit} allocated
                </span>
              </div>
              <StockLevelBar available={item.available} minStock={item.minStock} quantity={item.quantity} />
            </div>

            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface/50 p-3 text-sm sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Suggested order</dt>
                <dd className="tabular mt-0.5 font-semibold">
                  {formatNumber(item.suggestedQuantity)} {item.unit}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Estimated cost</dt>
                <dd className="mt-0.5 font-semibold">
                  <Money value={item.estimatedCost} />
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs text-muted-foreground">Usual vendor</dt>
                <dd className="mt-0.5 truncate font-medium">{item.vendor ?? "Not set"}</dd>
              </div>
            </dl>

            <footer className="mt-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                at <Money value={item.unitPrice} /> per {item.unit}
              </p>
              <Button asChild className="w-full sm:w-auto">
                <Link href={`/inventory/purchase?item=${item.id}&quantity=${item.suggestedQuantity}`}>
                  <PackagePlus /> Purchase
                </Link>
              </Button>
            </footer>
          </article>
        </li>
      ))}
    </ul>
  );
}
