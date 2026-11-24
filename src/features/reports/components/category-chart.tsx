"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { CategoryValue } from "../queries";

const config = { value: { label: "On-hand value", color: "var(--chart-1)" } } satisfies ChartConfig;
const MAX_BARS = 8;

/** On-hand stock value per category: one series, so no legend; the tooltip carries exact rupees. */
export function CategoryChart({ categories }: { categories: Pick<CategoryValue, "name" | "value">[] }) {
  const top = categories.slice(0, MAX_BARS);
  const rest = categories.slice(MAX_BARS);
  const data = rest.length ? [...top, { name: "Other categories", value: rest.reduce((s, c) => s + c.value, 0) }] : top;
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(180, data.length * 38 + 40) }} role="img" aria-label="On-hand stock value by category">
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }} barCategoryGap={10}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <YAxis dataKey="name" type="category" width={132} tickLine={false} axisLine={false} tickMargin={6} tick={{ fontSize: 12 }} />
        <XAxis type="number" tickFormatter={(v: number) => formatCompactCurrency(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={<ChartTooltipContent hideLabel={false} formatter={(value) => <span className="tabular font-medium">{formatCurrency(Number(value), { exact: true })}</span>} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}
