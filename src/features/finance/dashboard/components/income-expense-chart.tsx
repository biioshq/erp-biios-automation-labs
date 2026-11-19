"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency } from "@/lib/format";
import type { MonthlyPoint } from "../types";
import { MoneyTooltip, monthLabel } from "./chart-parts";

const config = {
  income: { label: "Income", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-2)" },
  profit: { label: "Profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Twelve months of income and expenses as paired bars, with profit as a line on the same axis. */
export function IncomeExpenseChart({ data }: { data: MonthlyPoint[] }) {
  const phone = useIsMobile();
  const summary = `Income, expenses and profit for the last ${data.length} months. ${data
    .map((m) => `${monthLabel(m.month)}: income ${formatCompactCurrency(m.income)}, expenses ${formatCompactCurrency(m.expenses)}, profit ${formatCompactCurrency(m.profit)}`)
    .join("; ")}.`;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-80" role="img" aria-label={summary}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={phone ? 1 : 2}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={phone ? 28 : 16} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<MoneyTooltip config={config} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Line
          dataKey="profit"
          type="monotone"
          stroke="var(--color-profit)"
          strokeWidth={2}
          dot={{ r: phone ? 2.5 : 3.5, fill: "var(--color-profit)", stroke: "var(--card)", strokeWidth: 2 }}
          activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
