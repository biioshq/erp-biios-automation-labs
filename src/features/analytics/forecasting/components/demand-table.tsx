"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HORIZONS, type Horizon } from "../constants";
import type { DemandRow } from "../types";
import { formatQty, formatRate } from "../utils";
import { ForecastStatusBadge, ItemLink } from "./status";

const dash = <span className="text-muted-foreground">-</span>;

const qtyCol = (id: string, title: string, pick: (r: DemandRow) => number | null, className?: string): ColumnDef<DemandRow> => ({
  id,
  accessorFn: (r) => pick(r) ?? -1,
  meta: { label: title, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => {
    const v = pick(row.original);
    return v === null ? dash : <span className={cn("tabular whitespace-nowrap", className)}>{formatQty(v, row.original.unit)}</span>;
  },
});

const horizonCol = (h: Horizon): ColumnDef<DemandRow> => qtyCol(`next${h}`, `Next ${h} days`, (r) => r.predicted?.[h] ?? null, h === 30 ? "font-medium" : undefined);

/** Demand forecast per material: recent use, expected use ahead, coverage and stockout. */
export function DemandTable({ rows, showProject }: { rows: DemandRow[]; showProject: boolean }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<DemandRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Material" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Material" />,
        cell: ({ row }) => <ItemLink id={row.original.id} name={row.original.name} sku={row.original.sku} sub={row.original.categoryName} />,
        enableHiding: false,
      },
      qtyCol("available", "Available", (r) => r.available),
      qtyCol("allocated", "Issued to projects", (r) => r.allocated),
      qtyCol("consumed", "Used in window", (r) => r.consumed),
      ...(showProject ? [qtyCol("projectConsumed", "Used on this project", (r) => r.projectConsumed)] : []),
      {
        id: "perDay",
        accessorFn: (r) => r.perDay ?? -1,
        meta: { label: "Average use", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Average use" align="right" />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{formatRate(row.original.perDay, row.original.unit)}</span>,
      },
      ...HORIZONS.map(horizonCol),
      {
        id: "cover",
        accessorFn: (r) => r.daysOfCover ?? Number.MAX_SAFE_INTEGER,
        meta: { label: "Stock lasts", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Stock lasts" align="right" />,
        cell: ({ row }) =>
          row.original.daysOfCover === null ? dash : <span className="tabular whitespace-nowrap">{Math.floor(row.original.daysOfCover)} days</span>,
      },
      {
        id: "stockout",
        accessorFn: (r) => r.stockoutDate ?? "9999",
        meta: { label: "Runs out on" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Runs out on" />,
        cell: ({ row }) => (row.original.stockoutDate ? <span className="whitespace-nowrap">{formatDate(row.original.stockoutDate)}</span> : dash),
      },
      qtyCol("extra", "Extra for 30 days", (r) => r.extraNeeded, "font-medium"),
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Forecast" },
        header: "Forecast",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-40 flex-col items-start gap-1">
            {/* Both badges on one line, so a row with an overstock note is not taller than the rest. */}
            <div className="flex flex-wrap items-center gap-1">
              <ForecastStatusBadge status={row.original.status} />
              {row.original.overstock ? (
                <StatusBadge tone="info" dot={false}>
                  {row.original.overstock}
                </StatusBadge>
              ) : null}
            </div>
            {row.original.reason ? <span className="text-xs text-muted-foreground">{row.original.reason}</span> : null}
          </div>
        ),
      },
    ],
    [showProject],
  );
  return (
    <DataTable
      id="forecast-demand"
      columns={columns}
      data={rows}
      searchPlaceholder="Search materials"
      initialHidden={["consumed"]}
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
            {formatQty(r.available, r.unit)} available
            {r.predicted ? <span className="text-muted-foreground"> · next 30 days {formatQty(r.predicted[30], r.unit)}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.status === "forecast"
              ? r.stockoutDate
                ? `Lasts about ${Math.floor(r.daysOfCover ?? 0)} days, runs out on ${formatDate(r.stockoutDate)}`
                : "No stockout expected"
              : r.reason}
            {r.overstock ? ` · ${r.overstock}` : ""}
          </p>
        </div>
      )}
    />
  );
}
