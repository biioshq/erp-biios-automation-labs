"use client";

import Link from "next/link";
import { useIsMobile } from "@/hooks/use-mobile";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/shared/empty-state";
import { STOCK_STATUS_META } from "@/lib/stock-status";
import { formatCompactCurrency, formatCurrency, formatNumber } from "@/lib/format";
import { BarChart3 } from "lucide-react";
import type { CategoryValue, DashboardSnapshot, WeeklyMovement } from "../types";

const HEALTH_COLORS = { in_stock: "var(--success)", low_stock: "var(--warning)", out_of_stock: "var(--danger)" } as const;
const HEALTH_KEYS = ["in_stock", "low_stock", "out_of_stock"] as const;

const healthConfig = {
  count: { label: "Items" },
  in_stock: { label: STOCK_STATUS_META.in_stock.label, color: HEALTH_COLORS.in_stock },
  low_stock: { label: STOCK_STATUS_META.low_stock.label, color: HEALTH_COLORS.low_stock },
  out_of_stock: { label: STOCK_STATUS_META.out_of_stock.label, color: HEALTH_COLORS.out_of_stock },
} satisfies ChartConfig;

/** Three status colours, same as every badge and bar. The legend doubles as filtered links. */
export function StockHealthChart({ snapshot }: { snapshot: DashboardSnapshot }) {
  const counts = { in_stock: snapshot.inStock, low_stock: snapshot.lowStock, out_of_stock: snapshot.outOfStock };
  const data = HEALTH_KEYS.map((key) => ({ key, name: healthConfig[key].label, count: counts[key], fill: HEALTH_COLORS[key] })).filter((d) => d.count > 0);
  if (snapshot.items === 0) {
    return <EmptyState compact icon={BarChart3} title="No items yet" description="Stock health appears once you add inventory." />;
  }
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
      <div className="relative size-44 shrink-0">
        <ChartContainer config={healthConfig} className="aspect-square size-44" role="img" aria-label="Items by stock status">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="key" />} />
            <Pie data={data} dataKey="count" nameKey="key" innerRadius={56} outerRadius={80} paddingAngle={data.length > 1 ? 3 : 0} cornerRadius={4} stroke="var(--card)" strokeWidth={2} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl leading-none font-semibold">{formatNumber(snapshot.items)}</span>
          <span className="mt-1 text-[11px] text-muted-foreground">items</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {HEALTH_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={`/inventory/items?status=${key}`}
              className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-muted/60"
            >
              <span className="flex items-center gap-2.5">
                <span className="size-2.5 rounded-full" style={{ background: HEALTH_COLORS[key] }} aria-hidden />
                {healthConfig[key].label}
              </span>
              <span className="tabular font-semibold">{formatNumber(counts[key])}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const valueConfig = { value: { label: "Stock value", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Stock on hand by category: top seven and the rest as "Other". */
export function CategoryValueChart({ categories }: { categories: CategoryValue[] }) {
  const mobile = useIsMobile();
  const nonZero = categories.filter((c) => c.value > 0);
  if (nonZero.length === 0) {
    return <EmptyState compact icon={BarChart3} title="No stock value yet" description="Purchase stock to see its value by category." />;
  }
  const top = nonZero.slice(0, 7);
  const rest = nonZero.slice(7);
  const data = [
    ...top.map((c) => ({ name: c.name, value: c.value, items: c.items })),
    ...(rest.length ? [{ name: "Other", value: rest.reduce((n, c) => n + c.value, 0), items: rest.reduce((n, c) => n + c.items, 0) }] : []),
  ];
  return (
    <ChartContainer
      config={valueConfig}
      className="aspect-auto w-full"
      style={{ height: Math.max(180, data.length * 38 + 28) }}
      role="img"
      aria-label="Inventory value by category"
    >
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: mobile ? 8 : 16, bottom: 0, left: 0 }} barCategoryGap={10}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <YAxis
          dataKey="name"
          type="category"
          width={mobile ? 88 : 112}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: mobile ? 11 : 12 }}
          tickFormatter={(v: string) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)}
        />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={6} tickCount={mobile ? 3 : 5} tick={{ fontSize: mobile ? 11 : 12 }} tickFormatter={(v: number) => formatCompactCurrency(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="font-medium">{(item.payload as { name: string }).name}</span>
                  <span className="tabular">{formatCurrency(Number(value))}</span>
                  <span className="text-muted-foreground">{formatNumber((item.payload as { items: number }).items)} items</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ChartContainer>
  );
}

const movementConfig = {
  purchased: { label: "Purchased", color: "var(--chart-3)" },
  assigned: { label: "Assigned", color: "var(--chart-2)" },
  returned: { label: "Returned", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** Units moved per week over the last 30 days. */
export function MovementTrendChart({ weeks }: { weeks: WeeklyMovement[] }) {
  const mobile = useIsMobile();
  const empty = weeks.every((w) => w.purchased + w.assigned + w.returned === 0);
  if (empty) {
    return <EmptyState compact icon={BarChart3} title="No movement in the last 30 days" description="Purchases, assignments and returns show up here week by week." />;
  }
  return (
    <ChartContainer config={movementConfig} className="aspect-auto h-60 w-full sm:h-64" role="img" aria-label="Units purchased, assigned and returned per week">
      <BarChart data={weeks} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={mobile ? 1 : 3}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} tick={{ fontSize: mobile ? 11 : 12 }} />
        <YAxis width={mobile ? 30 : 40} tick={{ fontSize: mobile ? 11 : 12 }} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => formatNumber(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={<ChartTooltipContent labelFormatter={(_, payload) => `Week of ${(payload?.[0]?.payload as WeeklyMovement | undefined)?.range ?? ""}`} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="purchased" fill="var(--color-purchased)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="assigned" fill="var(--color-assigned)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="returned" fill="var(--color-returned)" radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}
