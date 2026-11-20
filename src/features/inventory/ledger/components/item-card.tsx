import { StockStatusBadge } from "@/components/shared/status-badge";
import { StockLevelBar } from "@/components/shared/stock-level-bar";
import { Money } from "@/components/shared/money";
import { formatNumber } from "@/lib/format";
import type { StockStatus } from "@/lib/constants";
import { poolsOf } from "../stock-cost";
import type { LedgerItem } from "../types";

export const STATUS_DOT: Record<StockStatus, string> = {
  in_stock: "bg-success",
  low_stock: "bg-warning",
  out_of_stock: "bg-danger",
};

export function StatusDot({ status }: { status: StockStatus }) {
  return <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} aria-hidden />;
}

/** The selected item's current stock: status, level bar and the three numbers that matter. */
export function ItemCard({ item, title = "Current stock", showExpensed = false }: { item: LedgerItem; title?: string; showExpensed?: boolean }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <p className="eyebrow">{title}</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight">{item.name}</h3>
          <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
        </div>
        <StockStatusBadge status={item.status} />
      </div>
      <StockLevelBar available={item.available} minStock={item.minStock} quantity={item.quantity} className="mt-4" />
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="Available" value={`${formatNumber(item.available)} ${item.unit}`} />
        <Stat label="Allocated" value={`${formatNumber(item.allocated)} ${item.unit}`} />
        <Stat label="Minimum" value={`${formatNumber(item.minStock)} ${item.unit}`} />
      </dl>
      <p className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>Average cost per {item.unit}</span>
        <Money value={item.unitPrice} className="font-medium text-foreground" />
      </p>
      {showExpensed && item.available > 0 ? <ExpensedSplit item={item} /> : null}
    </section>
  );
}

/** How much of the stock on hand was expensed when bought, and how much is expensed when it is used. */
function ExpensedSplit({ item }: { item: LedgerItem }) {
  const pools = poolsOf(item);
  return (
    <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <dt>Not expensed yet, added to expenses when used</dt>
        <dd className="tabular shrink-0 font-medium text-foreground">
          {formatNumber(pools.unexpensedQty)} {item.unit}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt>Expensed at purchase</dt>
        <dd className="tabular shrink-0 font-medium text-foreground">
          {formatNumber(pools.expensedQty)} {item.unit}
        </dd>
      </div>
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}
