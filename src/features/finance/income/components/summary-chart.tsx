"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { MonthPoint } from "../summary";

const config = {
  received: { label: "Cash received", color: "var(--chart-1)" },
  invoiced: { label: "Invoiced", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** "2026-11" → "Nov 26" */
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

type Entry = { dataKey?: string | number; value?: number | string; color?: string };

function Tip({ active, payload, label }: { active?: boolean; payload?: readonly Entry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{typeof label === "string" ? monthLabel(label) : label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{config[String(p.dataKey) as keyof typeof config]?.label}</span>
          <span className="tabular ml-auto pl-4 font-medium text-foreground">{formatCurrency(Number(p.value), { whole: true })}</span>
        </div>
      ))}
    </div>
  );
}

/** Cash received and invoiced per month, side by side. They are separate measures, never stacked. */
export function SummaryChart({ data }: { data: MonthPoint[] }) {
  const phone = useIsMobile();
  const summary = `Cash received and invoiced by month. ${data
    .map((m) => `${monthLabel(m.month)}: received ${formatCompactCurrency(m.received)}, invoiced ${formatCompactCurrency(m.invoiced)}`)
    .join("; ")}.`;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-80" role="img" aria-label={summary}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={phone ? 1 : 2}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={phone ? 28 : 16} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="received" fill="var(--color-received)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}
