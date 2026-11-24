"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConsumptionRow } from "../types";
import { formatQty } from "../utils";
import { ForecastStatusBadge, ItemLink } from "./status";

const dash = <span className="text-muted-foreground">-</span>;

const qtyCol = (id: string, title: string, pick: (r: ConsumptionRow) => number | null, className?: string): ColumnDef<ConsumptionRow> => ({
  id,
  accessorFn: (r) => pick(r) ?? -1,
  meta: { label: title, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => {
    const v = pick(row.original);
    return v === null ? dash : <span className={cn("tabular whitespace-nowrap", className)}>{formatQty(v, row.original.unit)}</span>;
  },
});

function TrendText({ trend }: { trend: number | null }) {
  if (trend === null) return dash;
  if (trend === 0) return <span className="text-muted-foreground">No change</span>;
  const Icon = trend > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="tabular inline-flex items-center gap-0.5 whitespace-nowrap">
      <Icon className="size-3.5" aria-hidden />
      {formatPercent(Math.abs(trend))}
      <span className="sr-only">{trend > 0 ? "up" : "down"}</span>
    </span>
  );
}

/** Average use per day, week and month, recent trend and the next 30 days, per material. */
export function ConsumptionTable({ rows }: { rows: ConsumptionRow[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<ConsumptionRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Material" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Material" />,
        cell: ({ row }) => <ItemLink id={row.original.id} name={row.original.name} sku={row.original.sku} sub={row.original.categoryName} />,
        enableHiding: false,
      },
      qtyCol("consumed", "Used in window", (r) => r.consumed, "font-medium"),
      qtyCol("daily", "Per day", (r) => (r.measuredPerDay === null ? null : Math.round(r.measuredPerDay * 100) / 100)),
      qtyCol("weekly", "Per week", (r) => (r.measuredPerDay === null ? null : Math.round(r.measuredPerDay * 7 * 100) / 100)),
      qtyCol("monthly", "Per 30 days", (r) => (r.measuredPerDay === null ? null : Math.round(r.measuredPerDay * 30 * 100) / 100)),
      qtyCol("last4", "Last 4 weeks", (r) => r.last4Weeks),
      qtyCol("prev4", "4 weeks before", (r) => r.prev4Weeks),
      {
        id: "trend",
        accessorFn: (r) => r.trend ?? Number.NEGATIVE_INFINITY,
        meta: { label: "Change", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Change" align="right" />,
        cell: ({ row }) => <TrendText trend={row.original.trend} />,
      },
      qtyCol("next30", "Next 30 days", (r) => r.next30, "font-medium"),
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Forecast" },
        header: "Forecast",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-36 flex-col items-start gap-1">
            <ForecastStatusBadge status={row.original.status} />
            {row.original.reason ? <span className="text-xs text-muted-foreground">{row.original.reason}</span> : null}
          </div>
        ),
      },
    ],
    [],
  );
  return (
    <DataTable
      id="forecast-consumption"
      columns={columns}
      data={rows}
      searchPlaceholder="Search materials"
      pageSize={25}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/inventory/items/${r.id}`)}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{r.sku}</p>
            </div>
            <ForecastStatusBadge status={r.status} />
          </div>
          <p className="tabular text-sm">
            {formatQty(r.consumed, r.unit)} used
            <span className="text-muted-foreground">
              {" "}
              · last 4 weeks {formatQty(r.last4Weeks)}, before {formatQty(r.prev4Weeks)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{r.next30 !== null ? `Next 30 days: ${formatQty(r.next30, r.unit)}` : r.reason}</p>
        </div>
      )}
    />
  );
}

/** Materials whose recent use moved sharply, with the rule's figures. */
export function UnusualList({ rows }: { rows: ConsumptionRow[] }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <ItemLink id={r.id} name={r.name} sku={r.sku} />
            <p className="text-xs text-muted-foreground">{r.unusual?.text}</p>
          </div>
          <StatusBadge tone={r.unusual?.direction === "up" ? "warning" : "info"} className="shrink-0 self-start">{r.unusual?.direction === "up" ? "Increase" : "Decrease"}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

/** Materials wasted in the window: units, value and their share of what left storage. */
export function WastageList({ rows }: { rows: ConsumptionRow[] }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <ItemLink id={r.id} name={r.name} sku={r.sku} />
          <div className="tabular shrink-0 text-left text-sm sm:text-right">
            <span className="font-medium">{formatQty(r.wasted, r.unit)}</span> · <Money value={r.wastedValue} />
            {r.wastageShare !== null ? <p className="text-xs text-muted-foreground">{formatPercent(r.wastageShare)} of units used or wasted</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
