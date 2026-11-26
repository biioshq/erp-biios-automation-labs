import { cn } from "@/lib/utils";
import { BUDGET_BAR_CLASS, budgetTone } from "../utils";

/**
 * Spent against budget: blue, yellow from 80%, red above 100%. With `paid`, the spent part is drawn
 * in two pieces: paid (solid) then still owed to vendors (lighter), so the bar still shows the whole
 * spend once and the split inside it.
 */
export function BudgetBar({ spent, budget, paid, className }: { spent: number; budget: number; paid?: number; className?: string }) {
  const usage = budget > 0 ? spent / budget : spent > 0 ? 1.01 : 0;
  const tone = budgetTone(usage, budget > 0 ? budget : 1);
  const width = Math.min(1, usage) * 100;
  // The paid part as a share of the drawn spend, so the two pieces always fill exactly `width`.
  const paidShare = paid === undefined || spent <= 0 ? 1 : Math.min(1, Math.max(0, paid / spent));
  return (
    <div
      role="progressbar"
      aria-label="Budget used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(usage * 100))}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {paid === undefined ? (
        <div className={cn("h-full rounded-full transition-[width] duration-500", BUDGET_BAR_CLASS[tone])} style={{ width: `${width}%` }} />
      ) : (
        <div className="flex h-full overflow-hidden rounded-full transition-[width] duration-500" style={{ width: `${width}%` }}>
          <div className={cn("h-full", BUDGET_BAR_CLASS[tone])} style={{ width: `${paidShare * 100}%` }} />
          <div className={cn("h-full opacity-40", BUDGET_BAR_CLASS[tone])} style={{ width: `${(1 - paidShare) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/** The two pieces of a BudgetBar drawn with `paid`, for a legend under it. */
export function PaidOwedLegend({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)} aria-hidden>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-info" /> Paid
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-info opacity-40" /> Outstanding
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-muted ring-1 ring-border ring-inset" /> Budget left
      </span>
    </p>
  );
}
