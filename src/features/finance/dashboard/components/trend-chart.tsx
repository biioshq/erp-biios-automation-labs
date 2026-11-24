"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency } from "@/lib/format";
import type { Trends, TrendPoint } from "../types";
import { MoneyTooltip, monthLabel } from "./chart-parts";

const config = {
  income: { label: "Income", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-2)" },
  profit: { label: "Profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

const VIEWS = [
  { value: "month", label: "Monthly", note: "Last 12 months" },
  { value: "quarter", label: "Quarterly", note: "Last 8 financial quarters (Q1 is April to June)" },
  { value: "year", label: "Yearly", note: "Last 5 financial years" },
] as const;
type View = (typeof VIEWS)[number]["value"];

const identity = (s: string) => s;

/** Income and expenses as paired bars with profit as a line, by month, financial quarter or financial year. */
export function TrendChart({ trends }: { trends: Trends }) {
  const phone = useIsMobile();
  const [view, setView] = useState<View>("month");
  const data: TrendPoint[] = trends[view];
  const format = view === "month" ? monthLabel : identity;
  const note = VIEWS.find((v) => v.value === view)!.note;
  const summary = `Income, expenses and profit, ${note.toLowerCase()}. ${data
    .map((p) => `${format(view === "month" ? p.key : p.label)}: income ${formatCompactCurrency(p.income)}, expenses ${formatCompactCurrency(p.expenses)}, profit ${formatCompactCurrency(p.profit)}`)
    .join("; ")}.`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{note}</p>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Trend view">
          {VIEWS.map((v) => (
            <ToggleGroupItem key={v.value} value={v.value} className="px-3 text-xs max-md:h-9 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-80" role="img" aria-label={summary}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={phone ? 1 : 2}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey={view === "month" ? "key" : "label"}
            tickFormatter={format}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={phone ? "preserveStartEnd" : 0}
            minTickGap={phone ? 28 : 16}
            tick={{ fontSize: phone ? 11 : 12 }}
          />
          <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<MoneyTooltip config={config} formatLabel={format} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={view === "month" ? 18 : 28} />
          <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={view === "month" ? 18 : 28} />
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
    </div>
  );
}
