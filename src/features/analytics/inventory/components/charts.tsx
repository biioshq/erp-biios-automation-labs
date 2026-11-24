"use client";

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Charts of the inventory and project analytics pages (recharts through components/ui/chart).
 * Every chart carries a text summary for screen readers, and money axes use the compact rupee form.
 */

type Entry = { dataKey?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> };

function MoneyTip({ active, payload, config, labelKey }: { active?: boolean; payload?: readonly Entry[]; config: ChartConfig; labelKey: string }) {
  if (!active || !payload?.length) return null;
  const label = String(payload[0]?.payload?.[labelKey] ?? "");
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{config[String(p.dataKey)]?.label}</span>
          <span className="tabular ml-auto pl-4 font-medium text-foreground">{formatCurrency(Number(p.value), { whole: true })}</span>
        </div>
      ))}
    </div>
  );
}

export type BarSeries = { key: string; label: string; color: string };

/**
 * Rupee bars per row of `data`: grouped, or stacked when `stacked`. `labelKey` names the field
 * shown on the x axis and in the tooltip; `highlightKey` marks rows to draw in the warning colour
 * (single-series charts only).
 */
export function MoneyBars({
  data,
  labelKey,
  series,
  stacked,
  highlightKey,
  summary,
  className,
  phoneLabelKey,
}: {
  data: Record<string, string | number | boolean>[];
  labelKey: string;
  series: BarSeries[];
  stacked?: boolean;
  highlightKey?: string;
  summary: string;
  className?: string;
  /** Phones: a shorter axis label per bar, so every bar keeps its label. The tooltip keeps the full one. */
  phoneLabelKey?: string;
}) {
  const phone = useIsMobile();
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;
  const short = phone && phoneLabelKey ? new Map(data.map((d) => [String(d[labelKey]), String(d[phoneLabelKey])])) : null;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-64 w-full sm:h-72", className)} role="img" aria-label={summary}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey={labelKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={short ? 0 : "preserveStartEnd"}
          minTickGap={phone ? 28 : 16}
          tick={{ fontSize: phone ? 11 : 12 }}
          tickFormatter={short ? (v: string) => short.get(String(v)) ?? String(v) : undefined}
        />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<MoneyTip config={config} labelKey={labelKey} />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stacked ? "s" : undefined}
            fill={`var(--color-${s.key})`}
            stroke={stacked ? "var(--card)" : undefined}
            strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={stacked ? 32 : 22}
          >
            {highlightKey && series.length === 1
              ? data.map((row, j) => <Cell key={j} fill={row[highlightKey] ? "var(--warning)" : `var(--color-${s.key})`} />)
              : null}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/** Cumulative spend (bars) against the budget in force each month (a stepped line). */
export function SpendVsBudget({
  data,
  summary,
}: {
  data: { label: string; cumulative: number; budget: number; monthSpend: number }[];
  summary: string;
}) {
  const phone = useIsMobile();
  const config = {
    cumulative: { label: "Spent to date", color: "var(--chart-1)" },
    budget: { label: "Budget in force", color: "var(--chart-2)" },
    monthSpend: { label: "Spent that month", color: "var(--chart-3)" },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-80" role="img" aria-label={summary}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={phone ? 28 : 16} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<MoneyTip config={config} labelKey="label" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="cumulative" fill="var(--color-cumulative)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="monthSpend" fill="var(--color-monthSpend)" radius={[4, 4, 0, 0]} maxBarSize={12} />
        <Line dataKey="budget" type="stepAfter" stroke="var(--color-budget)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
