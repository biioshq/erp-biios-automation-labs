"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompactCurrency, formatCurrency, formatDateShort, formatNumber } from "@/lib/format";
import type { ItemPurchasePoint } from "../types";

const config = { unitCost: { label: "Unit price", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Unit price of each purchase, oldest to newest. */
export function PriceTrendChart({ points }: { points: ItemPurchasePoint[] }) {
  const data = points.map((p) => ({ ...p, label: formatDateShort(p.date) }));
  const prices = data.map((d) => d.unitCost);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = Math.max((max - min) * 0.25, max * 0.05, 1);
  return (
    <ChartContainer config={config} className="aspect-auto h-44 w-full" role="img" aria-label="Purchase unit price over time">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis
          width={52}
          tickLine={false}
          axisLine={false}
          domain={[Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]}
          tickFormatter={(v: number) => formatCompactCurrency(v)}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              indicator="line"
              formatter={(value, _name, item) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="tabular font-medium">{formatCurrency(Number(value))} per unit</span>
                  <span className="text-muted-foreground">
                    {formatNumber((item.payload as ItemPurchasePoint).quantity)} bought
                    {(item.payload as ItemPurchasePoint).vendor ? ` from ${(item.payload as ItemPurchasePoint).vendor}` : ""}
                  </span>
                </div>
              )}
            />
          }
        />
        <Line
          dataKey="unitCost"
          type="monotone"
          stroke="var(--color-unitCost)"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, fill: "var(--card)", stroke: "var(--color-unitCost)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
