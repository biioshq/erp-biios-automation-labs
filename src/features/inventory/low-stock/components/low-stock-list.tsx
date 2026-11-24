import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AlertLevel, LowStockItem } from "../types";

const LEVELS: Record<AlertLevel, { label: string; tone: "danger" | "warning" | "info" }> = {
  out: { label: "Out of stock", tone: "danger" },
  below_min: { label: "At or below minimum", tone: "warning" },
  runs_out: { label: "Runs out soon", tone: "info" },
};

export function AlertLevelBadge({ level }: { level: AlertLevel }) {
  return <StatusBadge tone={LEVELS[level].tone}>{LEVELS[level].label}</StatusBadge>;
}

const perDay = (i: LowStockItem) => (i.perDay !== null ? `${formatNumber(Math.round(i.perDay * 100) / 100)} ${i.unit}` : "No recorded use");
const leadTime = (i: LowStockItem) => (i.leadTimeDays !== null ? `${formatNumber(i.leadTimeDays)} ${i.leadTimeDays === 1 ? "day" : "days"}` : "Not set");
const purchaseHref = (i: LowStockItem) => `/inventory/purchase?item=${i.id}${i.suggestedQty ? `&quantity=${i.suggestedQty}` : ""}`;

/** The order-by date, in red once it is today or past. */
function OrderBy({ item, today }: { item: LowStockItem; today: string }) {
  if (!item.orderBy) return <span className="text-muted-foreground">-</span>;
  const late = item.orderBy <= today;
  return <span className={cn(late && "font-semibold text-danger")}>{late ? "Order now" : formatDate(item.orderBy)}</span>;
}

function ItemName({ item }: { item: LowStockItem }) {
  return (
    <div className="min-w-0">
      <Link href={`/inventory/items/${item.id}`} className="block truncate font-medium hover:underline">
        {item.name}
      </Link>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="font-mono">{item.sku}</span>
        {item.category ? (
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: item.category.color }} />
            {item.category.name}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The reorder list: a table on wider screens (scrolling inside its own box), cards on phones.
 * `canPurchase` hides the Purchase buttons from people who may not record a purchase.
 */
export function LowStockList({ items, today, canPurchase }: { items: LowStockItem[]; today: string; canPurchase: boolean }) {
  // Fits the card at 1440px: the minimum sits under Available and the stockout date under Days of
  // cover (as on the phone cards), and Lead time shows only when an item has one.
  const showLeadTime = items.some((i) => i.leadTimeDays !== null);
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Use per day</TableHead>
              <TableHead className="text-right">Days of cover</TableHead>
              <TableHead>Order by</TableHead>
              {showLeadTime ? <TableHead className="text-right">Lead time</TableHead> : null}
              <TableHead className="text-right">Suggested order</TableHead>
              <TableHead>Why</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="max-w-64 min-w-44">
                  <ItemName item={i} />
                </TableCell>
                <TableCell className={cn("tabular text-right font-semibold whitespace-nowrap", i.level === "out" ? "text-danger" : i.level === "below_min" && "text-warning")}>
                  {formatNumber(i.available)} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span>
                  <span className="block text-xs font-normal text-muted-foreground">min {formatNumber(i.minStock)}</span>
                </TableCell>
                <TableCell className="tabular max-w-28 text-right whitespace-normal text-muted-foreground">{perDay(i)}</TableCell>
                <TableCell className="tabular text-right whitespace-nowrap">
                  {i.daysOfCover !== null ? formatNumber(i.daysOfCover) : "-"}
                  {i.stockoutDate ? <span className="block text-xs text-muted-foreground">to {formatDate(i.stockoutDate)}</span> : null}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  <OrderBy item={i} today={today} />
                </TableCell>
                {showLeadTime ? <TableCell className="tabular text-right whitespace-nowrap text-muted-foreground">{leadTime(i)}</TableCell> : null}
                <TableCell className="tabular text-right whitespace-nowrap">
                  {i.suggestedQty ? (
                    <>
                      <span className="font-semibold">
                        {formatNumber(i.suggestedQty)} {i.unit}
                      </span>
                      {i.estimatedCost ? (
                        <span className="block text-xs text-muted-foreground">
                          <Money value={i.estimatedCost} />
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="max-w-60 min-w-40 whitespace-normal">
                  <AlertLevelBadge level={i.level} />
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {i.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  {canPurchase ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={purchaseHref(i)}>
                        <PackagePlus /> Purchase
                      </Link>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid grid-cols-1 gap-3 md:hidden">
        {items.map((i) => (
          <li key={i.id}>
            <article className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-card", i.level === "out" ? "border-danger/30" : i.level === "below_min" && "border-warning/25")}>
              <header className="flex items-start justify-between gap-3">
                <ItemName item={i} />
                <AlertLevelBadge level={i.level} />
              </header>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {i.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface/50 p-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Available</dt>
                  <dd className="tabular font-semibold">
                    {formatNumber(i.available)} <span className="text-xs font-normal text-muted-foreground">of {formatNumber(i.minStock)} minimum</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Use per day</dt>
                  <dd className="tabular">{perDay(i)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Days of cover</dt>
                  <dd className="tabular">
                    {i.daysOfCover !== null ? formatNumber(i.daysOfCover) : "-"}
                    {i.stockoutDate ? <span className="text-xs text-muted-foreground"> to {formatDate(i.stockoutDate)}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Order by</dt>
                  <dd className="tabular">
                    <OrderBy item={i} today={today} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Lead time</dt>
                  <dd className="tabular">{leadTime(i)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Suggested order</dt>
                  <dd className="tabular font-semibold">{i.suggestedQty ? `${formatNumber(i.suggestedQty)} ${i.unit}` : "-"}</dd>
                </div>
              </dl>
              {canPurchase ? (
                <Button asChild className="w-full">
                  <Link href={purchaseHref(i)}>
                    <PackagePlus /> Purchase
                  </Link>
                </Button>
              ) : null}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
