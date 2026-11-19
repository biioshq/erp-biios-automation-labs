import { cn } from "@/lib/utils";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";

/** A rupee amount in tabular figures. `compact` gives ₹3.5L style; `tone` colours income/expense. */
export function Money({
  value,
  compact,
  exact,
  tone,
  className,
}: {
  value: number | null | undefined;
  compact?: boolean;
  exact?: boolean;
  tone?: "positive" | "negative" | "auto";
  className?: string;
}) {
  const v = value ?? 0;
  const color =
    tone === "positive" ? "text-success" : tone === "negative" ? "text-danger" : tone === "auto" ? (v < 0 ? "text-danger" : "") : "";
  return (
    <span className={cn("tabular whitespace-nowrap", color, className)} title={compact ? formatCurrency(v, { exact: true }) : undefined}>
      {compact ? formatCompactCurrency(v) : formatCurrency(v, { exact })}
    </span>
  );
}
