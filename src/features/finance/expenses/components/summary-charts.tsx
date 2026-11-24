"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { DayPoint, MonthPoint } from "../summary-queries";

const monthConfig = {
  direct: { label: "Direct", color: "var(--chart-1)" },
  indirect: { label: "Indirect (overhead)", color: "var(--chart-2)" },
} satisfies ChartConfig;

const dayConfig = { total: { label: "Expenses recorded", color: "var(--chart-1)" } } satisfies ChartConfig;

/** "2026-11" to "Nov 26" */
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "2026-11-04" to "4 Nov" */
function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

type Entry = { dataKey?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> };

function Tip({
  active,
  payload,
  label,
  config,
  title,
  showTotal,
}: {
  active?: boolean;
  payload?: readonly Entry[];
  label?: string | number;
  config: ChartConfig;
  title: (key: string) => string;
  showTotal?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const total = Number(payload[0]?.payload?.total ?? 0);
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{typeof label === "string" ? title(label) : label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{config[String(p.dataKey)]?.label}</span>
          <span className="tabular ml-auto pl-4 font-medium text-foreground">{formatCurrency(Number(p.value), { whole: true })}</span>
        </div>
      ))}
      {showTotal ? (
        <div className="flex items-center gap-2 border-t pt-1.5">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular ml-auto pl-4 font-semibold text-foreground">{formatCurrency(total, { whole: true })}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Expenses recorded per month, direct stacked under indirect, so each bar is the month's total. */
export function MonthlyExpenseChart({ data }: { data: MonthPoint[] }) {
  const phone = useIsMobile();
  const summary = `Expenses recorded by month, direct and indirect. ${data
    .map((m) => `${monthLabel(m.month)}: ${formatCompactCurrency(m.total)} (direct ${formatCompactCurrency(m.direct)}, indirect ${formatCompactCurrency(m.indirect)})`)
    .join("; ")}.`;
  return (
    <ChartContainer config={monthConfig} className="aspect-auto h-64 w-full sm:h-80" role="img" aria-label={summary}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="month"
          tickFormatter={monthLabel}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={phone ? 28 : 16}
          tick={{ fontSize: phone ? 11 : 12 }}
        />
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip config={monthConfig} title={monthLabel} showTotal />} />
        <ChartLegend content={<ChartLegendContent />} />
        {/* A thin card-coloured stroke keeps a gap between the two stacked parts. */}
        <Bar dataKey="direct" stackId="n" fill="var(--color-direct)" stroke="var(--card)" strokeWidth={1} maxBarSize={28} />
        <Bar dataKey="indirect" stackId="n" fill="var(--color-indirect)" stroke="var(--card)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}

/** Expenses recorded on each day of the window. Days without any show as empty. */
export function DailyExpenseChart({ data }: { data: DayPoint[] }) {
  const phone = useIsMobile();
  const days = data.filter((d) => d.total > 0);
  const summary = `Expenses recorded by day. ${days.map((d) => `${dayLabel(d.day)}: ${formatCompactCurrency(d.total)}`).join("; ") || "None"}.`;
  return (
    <ChartContainer config={dayConfig} className="aspect-auto h-56 w-full sm:h-64" role="img" aria-label={summary}>
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
        <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={4} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip config={dayConfig} title={dayLabel} />} />
        <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}
