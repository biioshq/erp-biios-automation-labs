"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency } from "@/lib/format";
import { OTHER_KEY } from "../periods";
import type { CategoryStack } from "../types";
import { MoneyTooltip, monthLabel } from "./chart-parts";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const OTHER_COLOR = "var(--muted-foreground)";

/** Monthly expenses stacked by category (top categories plus Other). */
export function CategoryChart({ data }: { data: CategoryStack }) {
  const phone = useIsMobile();
  const config: ChartConfig = Object.fromEntries(
    data.series.map((s, i) => [
      s.key,
      s.color ? { label: s.label, theme: s.color } : { label: s.label, color: s.key === OTHER_KEY ? OTHER_COLOR : (COLORS[i] ?? OTHER_COLOR) },
    ]),
  );
  const summary = `Monthly expenses by category for the last ${data.rows.length} months. Categories: ${data.series.map((s) => s.label).join(", ")}.`;
  const top = data.series.length - 1;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72" role="img" aria-label={summary}>
      <BarChart data={data.rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={phone ? 24 : 8} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<MoneyTooltip config={config} total />} />
        <ChartLegend content={<ChartLegendContent />} />
        {data.series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="expenses"
            fill={`var(--color-${s.key})`}
            stroke="var(--card)"
            strokeWidth={2}
            maxBarSize={44}
            radius={i === top ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
