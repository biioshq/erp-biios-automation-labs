"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format";
import type { AccuracyByMonth, ManpowerMonth, MonthPoint, ProjectForecastRow, SpendPoint } from "../types";
import { formatQty } from "../utils";

/** Charts for the forecasting pages. Every chart has one value axis; tooltips show exact figures. */

/** "2026-11" → "Nov 26" */
export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

const fmtMoney = (v: unknown) => formatCurrency(Number(v), { whole: true });

/** A tooltip row: colour key, series label, value. */
function tooltipFormatter(config: ChartConfig, format: (v: unknown) => string) {
  function TooltipRow(value: unknown, name: unknown, item: { color?: string }) {
    return (
      <>
        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
        <span className="text-muted-foreground">{config[String(name)]?.label ?? String(name)}</span>
        <span className="tabular ml-auto pl-3 font-medium text-foreground">{format(value)}</span>
      </>
    );
  }
  return TooltipRow;
}

const defineConfig = <T extends ChartConfig>(c: T) => c;

/** Net value (or units, for one material) used per month. */
export function MonthlyUseChart({ months, unit }: { months: MonthPoint[]; unit: string | null }) {
  const phone = useIsMobile();
  const byQty = unit !== null;
  const config = defineConfig({ used: { label: byQty ? `Used (${unit})` : "Value used", color: "var(--chart-1)" } });
  const data = months.map((m) => ({ month: m.month, used: byQty ? m.consumedQty : m.consumedValue }));
  const format = byQty ? (v: unknown) => formatQty(Number(v), unit) : fmtMoney;
  const summary = `${config.used.label} per month: ${data.map((d) => `${monthLabel(d.month)} ${format(d.used)}`).join(", ")}.`;
  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full sm:h-72" role="img" aria-label={summary}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} minTickGap={phone ? 24 : 12} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis
          tickFormatter={(v: number) => (byQty ? formatQty(v) : formatCompactCurrency(v))}
          tickLine={false}
          axisLine={false}
          width={phone ? 44 : 56}
          tickCount={4}
          tick={{ fontSize: phone ? 11 : 12 }}
        />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent labelFormatter={(l) => monthLabel(String(l))} formatter={tooltipFormatter(config, format)} />} />
        <Bar dataKey="used" fill="var(--color-used)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}

/** Average value used in each calendar month (financial year order). */
export function SeasonalChart({ pattern }: { pattern: { label: string; average: number; years: number }[] }) {
  const phone = useIsMobile();
  const config = defineConfig({ average: { label: "Average value used", color: "var(--chart-2)" } });
  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full sm:h-72" role="img" aria-label={`Average value used per calendar month: ${pattern.map((p) => `${p.label} ${fmtMoney(p.average)}`).join(", ")}.`}>
      <BarChart data={pattern} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: phone ? 11 : 12 }} interval={phone ? 1 : 0} />
        <YAxis tickFormatter={(v: number) => formatCompactCurrency(v)} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={4} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent formatter={tooltipFormatter(config, fmtMoney)} />} />
        <Bar dataKey="average" fill="var(--color-average)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}

/** Budget, spend to date and predicted total per project, as horizontal bars. */
export function ProjectComparisonChart({ rows }: { rows: ProjectForecastRow[] }) {
  const config = defineConfig({
    budget: { label: "Budget", color: "var(--chart-3)" },
    spent: { label: "Spent to date", color: "var(--chart-1)" },
    predicted: { label: "Predicted total", color: "var(--chart-2)" },
  });
  // Only a run-rate prediction is drawn as a predicted bar; spend to date is already the spent bar.
  const data = rows.map((r) => ({ label: r.name, budget: r.budget, spent: r.spent, predicted: r.method === "run_rate" ? r.predictedTotal : null }));
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: Math.max(220, data.length * 64 + 60) }}
      role="img"
      aria-label={`Budget, spend to date and predicted total cost per project: ${data.map((d) => `${d.label}: budget ${fmtMoney(d.budget)}, spent ${fmtMoney(d.spent)}, ${d.predicted === null ? "no prediction" : `predicted ${fmtMoney(d.predicted)}`}`).join("; ")}.`}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 0 }} barCategoryGap={14} barGap={2}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" tickFormatter={(v: number) => formatCompactCurrency(v)} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickCount={4} />
        <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<ChartTooltipContent formatter={tooltipFormatter(config, fmtMoney)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="budget" fill="var(--color-budget)" radius={[0, 4, 4, 0]} maxBarSize={12} />
        <Bar dataKey="spent" fill="var(--color-spent)" radius={[0, 4, 4, 0]} maxBarSize={12} />
        <Bar dataKey="predicted" fill="var(--color-predicted)" radius={[0, 4, 4, 0]} maxBarSize={12} />
      </BarChart>
    </ChartContainer>
  );
}

/** One project's cumulative spend by month, the run-rate projection to its planned end, and its budget. */
export function ProjectSpendChart({ points, budget }: { points: SpendPoint[]; budget: number }) {
  const phone = useIsMobile();
  const config = defineConfig({
    actual: { label: "Spent (cumulative)", color: "var(--chart-1)" },
    projected: { label: "Projected at the run rate", color: "var(--chart-2)" },
  });
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full sm:h-72" role="img" aria-label={`Cumulative spend by month with the run-rate projection; budget ${fmtMoney(budget)}.`}>
      <LineChart data={points} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} minTickGap={phone ? 24 : 12} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickFormatter={(v: number) => formatCompactCurrency(v)} tickLine={false} axisLine={false} width={phone ? 44 : 56} tickCount={4} tick={{ fontSize: phone ? 11 : 12 }} domain={[0, (max: number) => Math.max(max, budget) * 1.05]} />
        {budget > 0 ? <ReferenceLine y={budget} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: "Budget", position: "insideTopLeft", fontSize: 11, fill: "var(--muted-foreground)" }} /> : null}
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => monthLabel(String(l))} formatter={tooltipFormatter(config, fmtMoney)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="actual" type="monotone" stroke="var(--color-actual)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        <Line dataKey="projected" type="linear" stroke="var(--color-projected)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls={false} />
      </LineChart>
    </ChartContainer>
  );
}

/** Allocated people (full-time equivalents) per month against active headcount. */
export function ManpowerChart({ months }: { months: ManpowerMonth[] }) {
  const phone = useIsMobile();
  const config = defineConfig({
    demandFte: { label: "Allocated (full-time equivalents)", color: "var(--chart-1)" },
    headcount: { label: "Active employees", color: "var(--chart-3)" },
  });
  const fmt = (v: unknown) => `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-60 w-full sm:h-72"
      role="img"
      aria-label={`Allocated full-time equivalents against active employees: ${months.map((m) => `${monthLabel(m.month)} ${fmt(m.demandFte)} of ${m.headcount}`).join(", ")}.`}
    >
      <ComposedChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis tickLine={false} axisLine={false} width={36} tickCount={4} allowDecimals={false} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent labelFormatter={(l) => monthLabel(String(l))} formatter={tooltipFormatter(config, fmt)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="demandFte" fill="var(--color-demandFte)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        <Line dataKey="headcount" type="stepAfter" stroke="var(--color-headcount)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}

/** Mean accuracy of the forecasts made in each month. */
export function AccuracyChart({ months, showProjects }: { months: AccuracyByMonth[]; showProjects: boolean }) {
  const phone = useIsMobile();
  const config = defineConfig({
    material: { label: "Material demand", color: "var(--chart-1)" },
    project: { label: "Project cost", color: "var(--chart-2)" },
  });
  const fmt = (v: unknown) => formatPercent(Number(v));
  return (
    <ChartContainer config={config} className="aspect-auto h-60 w-full sm:h-72" role="img" aria-label={`Forecast accuracy by month made: ${months.map((m) => `${monthLabel(m.month)} materials ${m.material === null ? "none" : fmt(m.material)}${showProjects ? `, projects ${m.project === null ? "none" : fmt(m.project)}` : ""}`).join("; ")}.`}>
      <LineChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: phone ? 11 : 12 }} />
        <YAxis domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v)} tickLine={false} axisLine={false} width={44} tickCount={5} tick={{ fontSize: phone ? 11 : 12 }} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => `Forecasts made in ${monthLabel(String(l))}`} formatter={tooltipFormatter(config, fmt)} />} />
        {showProjects ? <ChartLegend content={<ChartLegendContent />} /> : null}
        <Line dataKey="material" type="monotone" stroke="var(--color-material)" strokeWidth={2} dot={{ r: 3.5 }} connectNulls />
        {showProjects ? <Line dataKey="project" type="monotone" stroke="var(--color-project)" strokeWidth={2} dot={{ r: 3.5 }} connectNulls /> : null}
      </LineChart>
    </ChartContainer>
  );
}
