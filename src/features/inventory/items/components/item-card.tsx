"use client";

import Link from "next/link";
import { MapPin, Store } from "lucide-react";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { StockLevelBar } from "@/components/shared/stock-level-bar";
import { Money } from "@/components/shared/money";
import { INVENTORY_UNITS, labelOf } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ItemRow } from "../types";

export function OutOfStockHint({ className }: { className?: string }) {
  return <p className={cn("text-xs font-medium text-danger", className)}>Purchase before allocating</p>;
}

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("tabular text-base leading-tight font-semibold", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>
        {value}
      </p>
    </div>
  );
}

/** One item as a card: the figures people ask about first, then the status. */
export function ItemCard({ item, index = 0 }: { item: ItemRow; index?: number }) {
  const unit = labelOf(INVENTORY_UNITS, item.unit).toLowerCase();
  return (
    <Link
      href={`/inventory/items/${item.id}`}
      style={{ animationDelay: `${Math.min(index, 11) * 30}ms` }}
      className="group animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-card transition-colors duration-300 fill-mode-both hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-[15px] font-semibold tracking-tight">{item.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{item.sku}</p>
        </div>
        <StockStatusBadge status={item.status} />
      </div>

      {item.category ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 shrink-0 rounded-full" style={{ background: item.category.color }} />
          <span className="truncate">{item.category.name}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/70">Uncategorized</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Figure
          label="Available"
          value={formatNumber(item.available)}
          tone={item.status === "out_of_stock" ? "danger" : item.status === "low_stock" ? "warning" : undefined}
        />
        <Figure label="Allocated" value={formatNumber(item.allocated)} />
        <Figure label="Minimum" value={formatNumber(item.minStock)} />
      </div>

      <div className="space-y-1.5">
        <StockLevelBar available={item.available} minStock={item.minStock} quantity={item.quantity} />
        <p className="text-[11px] text-muted-foreground">
          {formatNumber(item.available)} of {formatNumber(item.quantity)} {unit} available, rest assigned
        </p>
      </div>

      <div className="mt-auto flex items-end justify-between gap-3 border-t pt-3 text-xs">
        <div className="min-w-0 space-y-0.5 text-muted-foreground">
          {item.vendor ? (
            <p className="flex items-center gap-1.5 truncate">
              <Store className="size-3 shrink-0" /> {item.vendor}
            </p>
          ) : null}
          {item.location ? (
            <p className="flex items-center gap-1.5 truncate">
              <MapPin className="size-3 shrink-0" /> {item.location}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-muted-foreground">Unit price</p>
          <Money value={item.unitPrice} className="text-sm font-semibold" />
        </div>
      </div>
      {item.status === "out_of_stock" ? <OutOfStockHint className="-mt-2" /> : null}
    </Link>
  );
}
