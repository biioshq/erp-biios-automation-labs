"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { DailyDay } from "../types";

const config = {
  income: { label: "Income received", color: "var(--chart-3)" },
  expenses: { label: "Expenses incurred", color: "var(--chart-1)" },
  payments: { label: "Payments made", color: "var(--chart-2)" },
} satisfies ChartConfig;

/** "2026-11-04" to "4 Nov" */
function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

type Entry = { dataKey?: string | number; value?: number | string; color?: string };

function Tip({ active, payload, label }: { active?: boolean; payload?: readonly Entry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{typeof label === "string" ? dayLabel(label) : label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{config[p.dataKey as keyof typeof config]?.label}</span>
          <span className="tabular ml-auto pl-4 font-medium text-foreground">{formatCurrency(Number(p.value), { whole: true })}</span>
        </div>
      ))}
    </div>
  );
}

/** Income received, expenses incurred and payments made on each day of the range. */
export function DailyChart({ data }: { data: DailyDay[] }) {
  const phone = useIsMobile();
  const summary = `Income received, expenses incurred and payments made by day. ${data
    .filter((d) => d.income || d.expenses || d.payments)
    .map((d) => `${dayLabel(d.day)}: income ${formatCompactCurrency(d.income)}, expenses ${formatCompactCurrency(d.expenses)}, payments ${formatCompactCurrency(d.payments)}`)
    .join("; ")}.`;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-80" role="img" aria-label={summary}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={phone ? 32 : 20}
          tick={{ fontSize: phone ? 11 : 12 }}
        />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="income" fill="var(--color-income)" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[3, 3, 0, 0]} maxBarSize={14} />
        <Bar dataKey="payments" fill="var(--color-payments)" radius={[3, 3, 0, 0]} maxBarSize={14} />
      </BarChart>
    </ChartContainer>
  );
}
