import { cn } from "@/lib/utils";
import { BUDGET_BAR_CLASS, budgetTone } from "../utils";

/** Spent against budget: blue, yellow from 80%, red above 100%. */
export function BudgetBar({ spent, budget, className }: { spent: number; budget: number; className?: string }) {
  const usage = budget > 0 ? spent / budget : spent > 0 ? 1.01 : 0;
  const tone = budgetTone(usage, budget > 0 ? budget : 1);
  return (
    <div
      role="progressbar"
      aria-label="Budget used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(usage * 100))}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", BUDGET_BAR_CLASS[tone])} style={{ width: `${Math.min(1, usage) * 100}%` }} />
    </div>
  );
}
