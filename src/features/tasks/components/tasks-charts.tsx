"use client";

import { Bar, BarChart, CartesianGrid, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { TASK_PRIORITIES, TASK_STATUSES, labelOf } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import type { DashboardData } from "../types";

/** Status and priority colours match the badges used everywhere else. */
const STATUS_CONFIG = {
  count: { label: "Tasks" },
  pending: { label: "Pending", color: "var(--muted-foreground)" },
  in_progress: { label: "In Progress", color: "var(--info)" },
  review: { label: "Review", color: "var(--chart-4)" },
  completed: { label: "Completed", color: "var(--success)" },
  cancelled: { label: "Cancelled", color: "color-mix(in oklab, var(--muted-foreground) 45%, transparent)" },
} satisfies ChartConfig;

const PRIORITY_CONFIG = {
  count: { label: "Tasks" },
  low: { label: "Low", color: "var(--muted-foreground)" },
  medium: { label: "Medium", color: "var(--info)" },
  high: { label: "High", color: "var(--warning)" },
  urgent: { label: "Urgent", color: "var(--danger)" },
} satisfies ChartConfig;

const WEEK_CONFIG = { count: { label: "Completed", color: "var(--chart-3)" } } satisfies ChartConfig;

const axis = { tickLine: false, axisLine: false, tickMargin: 8 } as const;

export function StatusChart({ data }: { data: DashboardData["byStatus"] }) {
  const rows = data.map((d) => ({ ...d, label: labelOf(TASK_STATUSES, d.status), fill: `var(--color-${d.status})` }));
  return (
    <>
      <ChartContainer config={STATUS_CONFIG} className="aspect-auto h-60 w-full" role="img" aria-label="Tasks by status">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} interval={0} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="status" />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ChartContainer>
      <ul className="sr-only">
        {rows.map((r) => (
          <li key={r.status}>
            {r.label}: {r.count}
          </li>
        ))}
      </ul>
    </>
  );
}

export function PriorityChart({ data }: { data: DashboardData["byPriority"] }) {
  const rows = data.map((d) => ({ ...d, fill: `var(--color-${d.priority})` }));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <>
      <ChartContainer config={PRIORITY_CONFIG} className="aspect-auto h-60 w-full" role="img" aria-label="Open tasks by priority">
        <PieChart accessibilityLayer>
          <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="priority" />} />
          <Pie data={rows} dataKey="count" nameKey="priority" innerRadius={58} outerRadius={84} paddingAngle={rows.filter((r) => r.count).length > 1 ? 2 : 0} strokeWidth={2} stroke="var(--card)">
            <Label
              content={({ viewBox }) =>
                viewBox && "cx" in viewBox ? (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 4} className="fill-foreground text-2xl font-semibold">
                      {formatNumber(total)}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 16} className="fill-muted-foreground text-xs">
                      open
                    </tspan>
                  </text>
                ) : null
              }
            />
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="priority" />} />
        </PieChart>
      </ChartContainer>
      <ul className="sr-only">
        {rows.map((r) => (
          <li key={r.priority}>
            {labelOf(TASK_PRIORITIES, r.priority)}: {r.count}
          </li>
        ))}
      </ul>
    </>
  );
}

export function CompletedPerWeekChart({ data }: { data: DashboardData["completedPerWeek"] }) {
  return (
    <>
      <ChartContainer config={WEEK_CONFIG} className="aspect-auto h-60 w-full" role="img" aria-label="Tasks completed per week, last 8 weeks">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" {...axis} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} {...axis} width={40} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(label) => `Week from ${label}`} />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ChartContainer>
      <ul className="sr-only">
        {data.map((r) => (
          <li key={r.label}>
            Week from {r.label}: {r.count}
          </li>
        ))}
      </ul>
    </>
  );
}
