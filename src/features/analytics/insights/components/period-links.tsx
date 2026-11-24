import Link from "next/link";
import { cn } from "@/lib/utils";
import { DEFAULT_PERIOD, INSIGHT_PERIODS, type InsightPeriod } from "../period";

/** Period choice as plain links (no client code), keeping the page's other parameters. */
export function PeriodLinks({ value, basePath, keep = {} }: { value: InsightPeriod; basePath: string; keep?: Record<string, string | null> }) {
  const hrefOf = (period: InsightPeriod) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
    if (period !== DEFAULT_PERIOD) params.set("period", period);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    // Phones: a row of its own (never squeezed beside a button), with the five links sharing the width.
    <nav aria-label="Period" className="flex max-w-full overflow-x-auto rounded-lg border bg-muted/40 p-0.5 text-[13px] max-sm:w-full max-sm:min-w-full sm:text-sm">
      {INSIGHT_PERIODS.map((p) => (
        <Link
          key={p.value}
          href={hrefOf(p.value)}
          scroll={false}
          aria-current={p.value === value ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-1.5 py-1 text-center font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground max-sm:flex-1 sm:px-2.5",
            p.value === value && "bg-background text-foreground shadow-sm",
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
