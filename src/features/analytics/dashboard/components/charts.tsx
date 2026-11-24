"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { monthLabel } from "../rules";

/**
 * Charts for the Analytics dashboard and insights pages. One value axis each (never two scales);
 * series take the theme's chart colours in a fixed order, and every chart has a tooltip with exact
 * figures and an aria summary. Props are plain data so server pages can pass them straight in.
 */

export type ChartSeries = { key: string; label: string; color: string; stack?: string };
export type ChartFormat = "money" | "percent" | "count";

type Row = Record<string, string | number | null>;

const formatValue = (v: number, format: ChartFormat) =>
  format === "money" ? formatCurrency(v, { whole: true }) : format === "percent" ? formatPercent(v) : formatNumber(v);

const formatTick = (v: number, format: ChartFormat) => (format === "money" ? formatCompactCurrency(v) : format === "percent" ? `${Math.round(v * 100)}%` : formatNumber(v));

const configOf = (series: ChartSeries[]): ChartConfig => Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));

type Entry = { dataKey?: string | number; value?: number | string | null; color?: string; payload?: Row };

function Tip({
  active,
  payload,
  label,
  series,
  format,
  heading,
  noteKey,
}: {
  active?: boolean;
  payload?: readonly Entry[];
  label?: string | number;
  series: ChartSeries[];
  format: ChartFormat;
  heading: (label: string) => string;
  noteKey?: string;
}) {
  if (!active || !payload?.length) return null;
  const note = noteKey ? payload[0]?.payload?.[noteKey] : null;
  return (
    <div className="grid min-w-44 max-w-72 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{heading(String(label ?? ""))}</p>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey);
        return (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} aria-hidden />
            <span className="text-muted-foreground">{s?.label ?? p.dataKey}</span>
            <span className="tabular ml-auto pl-4 font-medium text-foreground">{p.value === null || p.value === undefined ? "Not recorded" : formatValue(Number(p.value), format)}</span>
          </div>
        );
      })}
      {note ? <p className="text-muted-foreground">{note}</p> : null}
    </div>
  );
}

const summaryOf = (rows: Row[], key: string, series: ChartSeries[], format: ChartFormat, heading: (l: string) => string) =>
  rows
    .map((r) => `${heading(String(r[key]))}: ${series.map((s) => `${s.label} ${r[s.key] === null ? "not recorded" : formatValue(Number(r[s.key] ?? 0), format)}`).join(", ")}`)
    .join("; ");

/** Values per month ("2026-11" in `month`), as columns. Stacked when the series share a `stack`. */
export function MonthChart({ data, series, format = "money", title, className }: { data: Row[]; series: ChartSeries[]; format?: ChartFormat; title: string; className?: string }) {
  const phone = useIsMobile();
  const config = configOf(series);
  const stacked = series.some((s) => s.stack);
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-64 w-full sm:h-72", className)} role="img" aria-label={`${title}. ${summaryOf(data, "month", series, format, monthLabel)}.`}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={phone ? 28 : 16} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickFormatter={(v: number) => formatTick(v, format)} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip series={series} format={format} heading={monthLabel} />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={s.stack}
            fill={`var(--color-${s.key})`}
            stroke="var(--card)"
            strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={stacked ? 28 : 18}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

/**
 * One row per thing (project, bucket), as horizontal bars so names stay readable on phones.
 * `reference` draws a line at a value (100% of budget). `noteKey` adds a line under the tooltip.
 */
export function BarsChart({
  data,
  series,
  format = "money",
  title,
  reference,
  noteKey,
  labelWidth = 150,
  className,
}: {
  data: Row[];
  series: ChartSeries[];
  format?: ChartFormat;
  title: string;
  reference?: { value: number; label: string };
  noteKey?: string;
  labelWidth?: number;
  className?: string;
}) {
  const phone = useIsMobile();
  const config = configOf(series);
  const stacked = series.some((s) => s.stack);
  const perRow = stacked ? 34 : 18 * series.length + 18;
  const height = Math.max(160, data.length * perRow + (series.length > 1 ? 72 : 40));
  const width = phone ? Math.min(labelWidth, 104) : labelWidth;
  // Cut long names to one line that fits the label width (an allowance of about 7px a character);
  // the tooltip shows the full name.
  const maxChars = Math.floor(width / (phone ? 6.6 : 7));
  const same = (l: string) => l;
  return (
    <ChartContainer config={config} className={cn("aspect-auto w-full", className)} style={{ height }} role="img" aria-label={`${title}. ${summaryOf(data, "label", series, format, same)}.`}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }} barCategoryGap={stacked ? 8 : 10} barGap={2}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" tickFormatter={(v: number) => formatTick(v, format)} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickCount={phone ? 3 : 5} interval="preserveStartEnd" />
        <YAxis
          type="category"
          dataKey="label"
          width={width}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: phone ? 11 : 12 }}
          tickFormatter={(v: string) => (v.length > maxChars ? `${v.slice(0, maxChars - 1).trimEnd()}…` : v)}
        />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<Tip series={series} format={format} heading={same} noteKey={noteKey} />} />
        {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
        {reference ? <ReferenceLine x={reference.value} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: reference.label, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }} /> : null}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={s.stack}
            fill={`var(--color-${s.key})`}
            stroke="var(--card)"
            strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [0, 4, 4, 0] : 0}
            maxBarSize={stacked ? 22 : 14}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export type PricePointProps = { date: string; price: number; qty: number; vendor: string; bought: boolean };

/** Unit price paid on each recorded purchase of one item, oldest first. */
export function PriceChart({ points, unit, title }: { points: PricePointProps[]; unit: string; title: string }) {
  const phone = useIsMobile();
  const config = { price: { label: `Price per ${unit}`, color: "var(--chart-1)" } } satisfies ChartConfig;
  const data = points.map((p, i) => ({ ...p, n: i }));
  // One date label per day: several purchases on the same day share the first one's label. The
  // right margin leaves room for half a date label, so the last one is not cut off.
  const ticks = data.filter((d, i) => i === 0 || d.date !== data[i - 1].date).map((d) => d.n);
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-64 w-full sm:h-72"
      role="img"
      aria-label={`${title}. ${points.map((p) => `${formatDate(fromDateInput(p.date))}: ${formatCurrency(p.price)} from ${p.vendor}`).join("; ")}.`}
    >
      <LineChart data={data} margin={{ top: 12, right: 28, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="n"
          type="number"
          domain={[0, Math.max(0, data.length - 1)]}
          ticks={ticks}
          tickFormatter={(n: number) => (data[n] ? formatDate(fromDateInput(data[n].date)) : "")}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval="preserveStartEnd"
          minTickGap={phone ? 40 : 24}
          tick={{ fontSize: phone ? 11 : 12 }}
          padding={{ left: 12, right: 12 }}
        />
        <YAxis tickFormatter={(v: number) => formatCompactCurrency(v)} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={phone ? 4 : 5} tick={{ fontSize: phone ? 11 : 12 }} domain={[0, "auto"]} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
            if (!p) return null;
            return (
              <div className="grid min-w-44 gap-1 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-xl">
                <p className="font-medium">{formatDate(fromDateInput(p.date))}</p>
                <p className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Price per {unit}</span>
                  <span className="tabular font-medium">{formatCurrency(p.price)}</span>
                </p>
                <p className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="tabular">{formatNumber(p.qty)}</span>
                </p>
                <p className="text-muted-foreground">{p.vendor}</p>
                {!p.bought ? <p className="text-muted-foreground">Opening or imported stock</p> : null}
              </div>
            );
          }}
        />
        <Line dataKey="price" type="linear" stroke="var(--color-price)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}
