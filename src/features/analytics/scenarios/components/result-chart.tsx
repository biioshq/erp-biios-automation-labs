"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency, formatNumber } from "@/lib/format";
import type { ResultChart } from "../types";

type Entry = { dataKey?: string | number; value?: number | string; color?: string };

function Tip({
  active,
  payload,
  label,
  config,
  fmt,
}: {
  active?: boolean;
  payload?: readonly Entry[];
  label?: string | number;
  config: ChartConfig;
  fmt: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{config[String(p.dataKey)]?.label}</span>
          <span className="tabular ml-auto pl-4 font-medium text-foreground">{fmt(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

/** Current against scenario per category, side by side. Two separate measures: never stacked. */
export function ScenarioResultChart({ chart }: { chart: ResultChart }) {
  const phone = useIsMobile();
  const config = {
    current: { label: chart.currentLabel, color: "var(--chart-3)" },
    scenario: { label: chart.scenarioLabel, color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const fmt = (v: number) => (chart.type === "money" ? formatCurrency(v, { whole: true }) : formatNumber(v));
  const axis = (v: number) => (chart.type === "money" ? formatCompactCurrency(v) : formatNumber(v));
  const label = `${chart.title}. ${chart.points.map((p) => `${p.label}: ${chart.currentLabel.toLowerCase()} ${fmt(p.current)}, ${chart.scenarioLabel.toLowerCase()} ${fmt(p.scenario)}`).join("; ")}.`;

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72" role="img" aria-label={label}>
      <BarChart data={chart.points} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={phone ? 1 : 2}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={phone ? 24 : 12}
          tick={{ fontSize: phone ? 11 : 12 }}
          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <YAxis tickFormatter={axis} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip config={config} fmt={fmt} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="current" fill="var(--color-current)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="scenario" fill="var(--color-scenario)" radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ChartContainer>
  );
}
