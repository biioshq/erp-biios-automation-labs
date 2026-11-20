import { Boxes, PackagePlus, Repeat } from "lucide-react";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ExpenseSource } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { ExpenseRow } from "../types";

/** Expenses created by inventory: edited through their purchase or assignment, never by hand. */
export const isInventoryExpense = (source: ExpenseSource) => source === "inventory_assignment" || source === "inventory_purchase";

/**
 * "Recurring", "Stock purchase", "From inventory" or "Stock used, counted at purchase" for generated
 * expenses; nothing for manual ones.
 */
export function ExpenseSourceBadge({
  source,
  countedAtPurchase = false,
  className,
}: {
  source: ExpenseSource;
  /** Stock expensed when it was bought: a project cost, left out of company totals. */
  countedAtPurchase?: boolean;
  className?: string;
}) {
  if (source === "recurring") {
    return (
      <StatusBadge tone="info" dot={false} icon={<Repeat className="size-3" aria-hidden />} className={className}>
        Recurring
      </StatusBadge>
    );
  }
  if (source === "inventory_purchase") {
    return (
      <StatusBadge tone="brand" dot={false} icon={<PackagePlus className="size-3" aria-hidden />} className={className}>
        Stock purchase
      </StatusBadge>
    );
  }
  if (source === "inventory_assignment" && countedAtPurchase) {
    // The tooltip helps on desktop; phones get a visible note on the card and in the detail drawer.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <StatusBadge tone="neutral" dot={false} icon={<Boxes className="size-3" aria-hidden />} className={className}>
              Stock used, counted at purchase
            </StatusBadge>
          </span>
        </TooltipTrigger>
        <TooltipContent>Expensed when the stock was bought, so it counts in the project&apos;s spend but not again in company totals</TooltipContent>
      </Tooltip>
    );
  }
  if (source === "inventory_assignment") {
    return (
      <StatusBadge tone="brand" dot={false} icon={<Boxes className="size-3" aria-hidden />} className={className}>
        From inventory
      </StatusBadge>
    );
  }
  return null;
}

/**
 * One expense as a phone card: vendor and amount, number and date, then project and badges.
 * `mutedIfCounted`: in a list whose totals leave out stock counted at purchase (the Expenses list),
 * those rows show a muted amount and say they are not in the totals. Not for project views, where they count.
 */
export function ExpenseMobileCard({
  row,
  showProject = true,
  mutedIfCounted = false,
}: {
  row: ExpenseRow;
  showProject?: boolean;
  mutedIfCounted?: boolean;
}) {
  const muted = mutedIfCounted && row.countedAtPurchase;
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate font-medium">{row.vendor}</p>
        <div className="shrink-0 text-right">
          <Money value={row.amount} className={muted ? "font-semibold text-muted-foreground" : "font-semibold"} />
          {muted ? <p className="text-[11px] text-muted-foreground">Not in totals</p> : null}
        </div>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-mono">{row.number}</span> · {formatDate(row.date)}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        {showProject ? (
          row.project ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.project.color }} aria-hidden />
              <span className="truncate">{row.project.name}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Overhead</span>
          )
        ) : null}
        <ExpenseSourceBadge source={row.source} countedAtPurchase={row.countedAtPurchase} className="h-5 px-2 text-[11px]" />
        <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
          {row.categoryLabel}
        </StatusBadge>
      </div>
    </div>
  );
}
