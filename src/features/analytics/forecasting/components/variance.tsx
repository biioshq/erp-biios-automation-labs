import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import type { ProjectForecastRow } from "../types";

/**
 * Expected overrun (red) or saving (green) against the budget, from the row's forecast. A row with
 * no figure, or showing spend to date, never shows a saving: only spend already above the budget.
 */
export function VarianceText({ row, className }: { row: Pick<ProjectForecastRow, "variance" | "budget" | "method">; className?: string }) {
  const { variance } = row;
  if (row.budget <= 0) return <span className={cn("text-xs text-muted-foreground", className)}>No budget</span>;
  if (variance === null) {
    return <span className={cn("text-xs text-muted-foreground", className)}>{row.method === "none" ? "No forecast" : "Within budget so far"}</span>;
  }
  if (variance === 0) return <span className={cn("text-muted-foreground", className)}>On budget</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", variance > 0 ? "text-danger" : "text-success", className)}>
      {variance > 0 ? (row.method === "run_rate" ? "Over by " : "Already over by ") : "Under by "}
      <Money value={Math.abs(variance)} />
    </span>
  );
}

/** The mark beside a predicted total: the rule's own label, or why there is none. */
export function methodText(row: Pick<ProjectForecastRow, "method" | "methodLabel">): string {
  if (row.method === "run_rate") return "Run rate to the planned end";
  return row.methodLabel ?? "No forecast";
}
