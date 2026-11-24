"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { ASSET_CONDITIONS, labelOf, type AssetCondition } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { EquipmentRow } from "../types";

const CONDITION_TONE: Record<AssetCondition, Tone> = { good: "success", under_maintenance: "info", damaged: "danger", lost: "neutral", disposed: "neutral" };

function ConditionBadge({ condition }: { condition: AssetCondition }) {
  return <StatusBadge tone={CONDITION_TONE[condition]}>{labelOf(ASSET_CONDITIONS, condition)}</StatusBadge>;
}

const dash = <span className="text-muted-foreground">-</span>;

function NextCell({ r }: { r: EquipmentRow }) {
  if (!r.nextDue) return <span className="block max-w-48 text-xs text-muted-foreground">{r.nextNote}</span>;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="whitespace-nowrap">{formatDate(r.nextDue)}</span>
      <span className="text-[11px] text-muted-foreground">{r.nextBasis === "recorded" ? "Recorded due date" : `Every ${r.intervalDays} days on average`}</span>
    </div>
  );
}

function DueIn({ days }: { days: number | null }) {
  if (days === null) return dash;
  if (days < 0) return <StatusBadge tone="danger">{-days} days overdue</StatusBadge>;
  if (days === 0) return <StatusBadge tone="warning">Due today</StatusBadge>;
  return <span className={days <= 30 ? "font-medium text-warning" : undefined}>In {days} days</span>;
}

/** Equipment with its last service, next expected service and anything that needs attention. */
export function EquipmentTable({ rows }: { rows: EquipmentRow[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<EquipmentRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Equipment" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Equipment" />,
        cell: ({ row }) => (
          <Link href={`/finance/assets/fixed?view=${row.original.id}`} className="block min-w-44 max-w-64" onClick={(e) => e.stopPropagation()}>
            <span className="block truncate font-medium hover:underline">{row.original.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              <span className="font-mono">{row.original.code}</span> · {row.original.groupLabel}
            </span>
          </Link>
        ),
        enableHiding: false,
      },
      { id: "condition", accessorKey: "condition", meta: { label: "Condition" }, header: "Condition", enableSorting: false, cell: ({ row }) => <ConditionBadge condition={row.original.condition} /> },
      {
        id: "last",
        accessorFn: (r) => r.lastMaintenance ?? "",
        meta: { label: "Last service" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last service" />,
        cell: ({ row }) => (row.original.lastMaintenance ? <span className="whitespace-nowrap">{formatDate(row.original.lastMaintenance)}</span> : <span className="text-xs text-muted-foreground">None recorded</span>),
      },
      {
        id: "count",
        accessorFn: (r) => r.history.length,
        meta: { label: "Services recorded", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Services recorded" align="right" />,
        cell: ({ row }) => <span className="tabular">{row.original.history.length}</span>,
      },
      {
        id: "next",
        accessorFn: (r) => r.nextDue ?? "9999",
        meta: { label: "Next expected service" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Next expected service" />,
        cell: ({ row }) => <NextCell r={row.original} />,
      },
      {
        id: "due",
        accessorFn: (r) => r.dueIn ?? Number.MAX_SAFE_INTEGER,
        meta: { label: "Due" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) => <DueIn days={row.original.dueIn} />,
      },
      {
        id: "usage",
        meta: { label: "Usage hours" },
        header: "Usage hours",
        enableSorting: false,
        cell: () => <span className="text-xs text-muted-foreground">Not recorded</span>,
      },
      {
        id: "cost",
        accessorFn: (r) => r.averageCost ?? -1,
        meta: { label: "Average service cost", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Average service cost" align="right" />,
        cell: ({ row }) =>
          row.original.averageCost === null ? (
            <span className="text-xs text-muted-foreground">No costs recorded</span>
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              <Money value={row.original.averageCost} />
              <span className="text-[11px] text-muted-foreground">from {row.original.costEntries}</span>
            </div>
          ),
      },
      {
        id: "attention",
        accessorFn: (r) => r.attention.length,
        meta: { label: "Needs attention" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Needs attention" />,
        cell: ({ row }) =>
          row.original.attention.length ? (
            <ul className="min-w-44 space-y-0.5 text-xs text-danger">
              {row.original.attention.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">Nothing</span>
          ),
      },
    ],
    [],
  );
  return (
    <DataTable
      id="forecast-equipment"
      columns={columns}
      data={rows}
      searchPlaceholder="Search equipment"
      pageSize={25}
      initialHidden={["usage"]}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/finance/assets/fixed?view=${r.id}`)}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{r.code}</p>
            </div>
            <ConditionBadge condition={r.condition} />
          </div>
          <p className="text-sm">
            {r.nextDue ? (
              <>
                Next service {formatDate(r.nextDue)} <span className="text-muted-foreground">({r.nextBasis === "recorded" ? "recorded" : `every ${r.intervalDays} days`})</span>
              </>
            ) : (
              <span className="text-muted-foreground">{r.nextNote}</span>
            )}
          </p>
          {r.attention.length ? <p className="text-xs text-danger">{r.attention.join(" · ")}</p> : null}
        </div>
      )}
    />
  );
}
