"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SCENARIO_STATUSES, SCENARIO_TYPES } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import { HISTORY_ACTIONS } from "../schemas";
import type { HistoryRow } from "../types";
import { ScenarioStatusBadge, ScenarioTypeBadge } from "./badges";

const actionLabel = (a: string) => HISTORY_ACTIONS.find((x) => x.value === a)?.label ?? a;

/** Every scenario's history in one list: changes, status moves and approvals. */
export function HistoryView({ data, users }: { data: Paginated<HistoryRow>; users: string[] }) {
  const columns = useMemo<ColumnDef<HistoryRow>[]>(
    () => [
      {
        id: "at",
        accessorKey: "at",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.at)}</span>,
        enableHiding: false,
      },
      {
        id: "scenario",
        meta: { label: "Scenario" },
        header: "Scenario",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-44">
            <Link href={`/analytics/scenarios/${row.original.scenario.id}`} className="font-medium hover:underline">
              {row.original.scenario.name}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] text-muted-foreground">{row.original.scenario.code}</span>
              <ScenarioTypeBadge type={row.original.scenario.type} className="h-5 px-2 text-[11px]" />
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "change",
        meta: { label: "Change" },
        header: "Change",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-56 space-y-0.5">
            <p className="font-medium">{actionLabel(row.original.action)}</p>
            {row.original.changes.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {c}
              </p>
            ))}
            {row.original.note ? <p className="text-xs [overflow-wrap:anywhere]">Note: {row.original.note}</p> : null}
          </div>
        ),
      },
      {
        id: "user",
        meta: { label: "User" },
        header: "User",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.byName ?? "Not recorded"}</span>,
      },
      {
        id: "status",
        meta: { label: "Status", align: "right" },
        header: "Status set",
        enableSorting: false,
        cell: ({ row }) => (row.original.status ? <ScenarioStatusBadge status={row.original.status} /> : <span className="text-xs text-muted-foreground">-</span>),
      },
    ],
    [],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "type", title: "Type", options: SCENARIO_TYPES.map((o) => ({ ...o })) },
      { key: "action", title: "Change", options: HISTORY_ACTIONS.map((o) => ({ ...o })) },
      { key: "status", title: "Status set", options: SCENARIO_STATUSES.map((o) => ({ ...o })) },
      { key: "user", title: "User", options: users.map((u) => ({ value: u, label: u })) },
    ],
    [users],
  );

  return (
    <DataTable
      id="scenario-history"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange
      searchPlaceholder="Search history…"
      getRowId={(r) => r.key}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/analytics/scenarios/${r.scenario.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.scenario.name}
            </Link>
            {r.status ? <ScenarioStatusBadge status={r.status} className="h-5 px-2 text-[11px]" /> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {actionLabel(r.action)} · {formatDateTime(r.at)} · {r.byName ?? "Not recorded"}
          </p>
          {r.changes.map((c, i) => (
            <p key={i} className="text-xs [overflow-wrap:anywhere]">
              {c}
            </p>
          ))}
          {r.note ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Note: {r.note}</p> : null}
        </div>
      )}
      emptyState={<EmptyState icon={History} title="No scenario history yet" description="Creating, editing, duplicating and approving scenarios is recorded here." />}
    />
  );
}
