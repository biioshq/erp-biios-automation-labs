"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MAJOR_DEVIATION } from "../constants";
import type { AccuracyByKey, AccuracyRow } from "../types";
import { formatQty, isMajorDifference } from "../utils";
import { monthLabel } from "./charts";

const KIND_LABEL = { material_demand: "Material demand", project_cost: "Project cost" } as const;

function Amount({ kind, value, unit, className }: { kind: AccuracyRow["kind"]; value: number; unit: string | null; className?: string }) {
  return kind === "project_cost" ? <Money value={value} className={className} /> : <span className={cn("tabular whitespace-nowrap", className)}>{formatQty(value, unit)}</span>;
}

function AccuracyText({ value }: { value: number }) {
  return <span className={cn("tabular font-medium", value >= 0.75 ? "text-success" : value >= 0.5 ? "text-warning" : "text-danger")}>{formatPercent(value)}</span>;
}

/** Each stored forecast whose period has ended, against what was recorded. */
export function AccuracyTable({ rows }: { rows: AccuracyRow[] }) {
  const columns = useMemo<ColumnDef<AccuracyRow>[]>(
    () => [
      {
        id: "label",
        accessorKey: "label",
        meta: { label: "Forecast" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Forecast" />,
        cell: ({ row }) => (
          <div className="min-w-44 max-w-64">
            <p className="truncate font-medium">{row.original.label}</p>
            <p className="text-[11px] text-muted-foreground">
              {KIND_LABEL[row.original.kind]} · made {monthLabel(row.original.month)}
            </p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "period",
        accessorKey: "to",
        meta: { label: "Period" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Period" />,
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap">
            {formatDate(row.original.from)} to {formatDate(row.original.to)}
          </span>
        ),
      },
      {
        id: "predicted",
        accessorKey: "predicted",
        meta: { label: "Forecast", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Forecast" align="right" />,
        cell: ({ row }) => <Amount kind={row.original.kind} value={row.original.predicted} unit={row.original.unit} />,
      },
      {
        id: "actual",
        accessorKey: "actual",
        meta: { label: "Actual", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actual" align="right" />,
        cell: ({ row }) => <Amount kind={row.original.kind} value={row.original.actual} unit={row.original.unit} className="font-medium" />,
      },
      {
        id: "difference",
        accessorKey: "difference",
        meta: { label: "Difference", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Difference" align="right" />,
        cell: ({ row }) => {
          const d = row.original.difference;
          return (
            <span className="inline-flex items-center gap-0.5">
              {d > 0 ? "+" : d < 0 ? "-" : ""}
              <Amount kind={row.original.kind} value={Math.abs(d)} unit={row.original.unit} />
            </span>
          );
        },
      },
      {
        id: "deviation",
        accessorFn: (r) => Math.abs(r.deviation),
        meta: { label: "Deviation", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Deviation" align="right" />,
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap">
            {row.original.deviation > 0 ? "+" : row.original.deviation < 0 ? "-" : ""}
            {formatPercent(Math.abs(row.original.deviation))}
          </span>
        ),
      },
      {
        id: "accuracy",
        accessorKey: "accuracy",
        meta: { label: "Accuracy", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Accuracy" align="right" />,
        cell: ({ row }) => <AccuracyText value={row.original.accuracy} />,
      },
      {
        id: "reason",
        meta: { label: "Reason" },
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) =>
          isMajorDifference(row.original) ? (
            <div className="flex min-w-36 flex-col items-start gap-1">
              <StatusBadge tone="warning">Major difference</StatusBadge>
              <span className="text-[11px] text-muted-foreground">Reason not recorded</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Within {formatPercent(MAJOR_DEVIATION)}</span>
          ),
      },
    ],
    [],
  );
  return (
    <DataTable
      id="forecast-accuracy"
      columns={columns}
      data={rows}
      searchPlaceholder="Search forecasts"
      pageSize={25}
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.label}</p>
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[r.kind]} · {formatDate(r.from)} to {formatDate(r.to)}
              </p>
            </div>
            <AccuracyText value={r.accuracy} />
          </div>
          <p className="text-sm">
            Forecast <Amount kind={r.kind} value={r.predicted} unit={r.unit} /> · actual <Amount kind={r.kind} value={r.actual} unit={r.unit} className="font-medium" />
          </p>
          {isMajorDifference(r) ? <p className="text-xs text-warning">Major difference; reason not recorded</p> : null}
        </div>
      )}
    />
  );
}

/** Mean accuracy per material or project over all its comparisons, least accurate first. */
export function AccuracyByKeyList({ rows }: { rows: AccuracyByKey[] }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={`${r.kind}:${r.key}`} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.label}</p>
            <p className="text-xs text-muted-foreground">
              {r.comparisons} {r.comparisons === 1 ? "comparison" : "comparisons"} · forecast <Amount kind={r.kind} value={r.predicted} unit={r.unit} />, actual{" "}
              <Amount kind={r.kind} value={r.actual} unit={r.unit} />
            </p>
          </div>
          <AccuracyText value={r.accuracy} />
        </li>
      ))}
    </ul>
  );
}
