"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { StageRow } from "../types";

const config = {
  spent: { label: "Spent", color: "var(--chart-1)" },
  planned: { label: "Planned", color: "var(--chart-3)" },
} satisfies ChartConfig;

/**
 * Spend per stage as horizontal bars (stage names stay readable at phone width).
 * With `showPlanned` the stage budget is drawn next to the actual spend and a legend appears.
 */
export function StageChart({ rows, showPlanned, className }: { rows: StageRow[]; showPlanned?: boolean; className?: string }) {
  const total = rows.reduce((s, r) => s + r.spent, 0) + (showPlanned ? rows.reduce((s, r) => s + r.planned, 0) : 0);
  if (total === 0) {
    return (
      <div className={cn("flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground", className)}>
        No spend recorded against a stage yet.
      </div>
    );
  }
  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", showPlanned ? "h-[420px]" : "h-[280px]", className)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }} barCategoryGap={showPlanned ? 14 : 10} barGap={3}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" tickFormatter={(v: number) => formatCompactCurrency(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickCount={4} interval="preserveStartEnd" />
        <YAxis type="category" dataKey="label" width={80} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(value, name, item) => (
                <>
                  <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? name}</span>
                  <span className="tabular ml-auto font-medium text-foreground">{formatCurrency(Number(value))}</span>
                </>
              )}
            />
          }
        />
        {showPlanned ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {showPlanned ? <Bar dataKey="planned" fill="var(--color-planned)" radius={[0, 4, 4, 0]} maxBarSize={14} /> : null}
        <Bar dataKey="spent" fill="var(--color-spent)" radius={[0, 4, 4, 0]} maxBarSize={showPlanned ? 14 : 18} />
      </BarChart>
    </ChartContainer>
  );
}
