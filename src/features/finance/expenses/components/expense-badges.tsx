import { Boxes, Repeat } from "lucide-react";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ExpenseSource } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { ExpenseRow } from "../types";

/** "Recurring" or "From inventory" for generated expenses; nothing for manual ones. */
export function ExpenseSourceBadge({ source, className }: { source: ExpenseSource; className?: string }) {
  if (source === "recurring") {
    return (
      <StatusBadge tone="info" dot={false} icon={<Repeat className="size-3" aria-hidden />} className={className}>
        Recurring
      </StatusBadge>
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

/** One expense as a phone card: vendor and amount, number and date, then project and badges. */
export function ExpenseMobileCard({ row, showProject = true }: { row: ExpenseRow; showProject?: boolean }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate font-medium">{row.vendor}</p>
        <Money value={row.amount} className="shrink-0 font-semibold" />
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
        <ExpenseSourceBadge source={row.source} className="h-5 px-2 text-[11px]" />
        <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
          {row.categoryLabel}
        </StatusBadge>
      </div>
    </div>
  );
}
