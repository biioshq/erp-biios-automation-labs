"use client";

import type { ChartConfig } from "@/components/ui/chart";
import { formatCurrency } from "@/lib/format";

/** "2026-11" → "Nov 26" */
export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

type Entry = { dataKey?: string | number; value?: number | string; color?: string; name?: string | number };

/**
 * Tooltip for money charts: month heading, one row per series with a colour
 * key and an exact rupee value, and a total when several series are stacked.
 */
export function MoneyTooltip({
  active,
  payload,
  label,
  config,
  total,
  formatLabel = monthLabel,
}: {
  active?: boolean;
  payload?: readonly Entry[];
  label?: string | number;
  config: ChartConfig;
  total?: boolean;
  /** Heading from the category label; month keys ("2026-11") by default. */
  formatLabel?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined && p.value !== null);
  const sum = rows.reduce((acc, p) => acc + Number(p.value ?? 0), 0);
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{typeof label === "string" ? formatLabel(label) : label}</p>
      <div className="grid gap-1.5">
        {[...rows].reverse().map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="text-muted-foreground">{config[String(p.dataKey)]?.label ?? p.name}</span>
            <span className="tabular ml-auto pl-4 font-medium text-foreground">{formatCurrency(Number(p.value), { whole: true })}</span>
          </div>
        ))}
      </div>
      {total && rows.length > 1 ? (
        <div className="mt-0.5 flex items-center justify-between border-t pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular font-semibold">{formatCurrency(sum, { whole: true })}</span>
        </div>
      ) : null}
    </div>
  );
}
