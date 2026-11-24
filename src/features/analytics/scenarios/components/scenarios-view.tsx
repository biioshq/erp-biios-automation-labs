"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { FlaskConical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SCENARIO_STATUSES, SCENARIO_TYPES } from "@/lib/constants";
import { formatDate, formatRelative } from "@/lib/format";
import { useCan } from "@/components/current-user";
import { ANALYTICS } from "../../links";
import type { Paginated } from "@/lib/list-params";
import type { ScenarioRow } from "../types";
import { ScenarioStatusBadge, ScenarioTypeBadge } from "./badges";

/** The scenario list: search, filters by type, status and creator; a row opens the scenario. */
export function ScenariosView({ data, creators }: { data: Paginated<ScenarioRow>; creators: { value: string; label: string }[] }) {
  const mayCreate = useCan(ANALYTICS.scenarios.create);
  const router = useRouter();
  const columns = useMemo<ColumnDef<ScenarioRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Name" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="min-w-48">
            <Link href={`/analytics/scenarios/${row.original.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
              {row.original.name}
            </Link>
            <p className="font-mono text-[11px] text-muted-foreground">{row.original.code}</p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "code",
        accessorKey: "code",
        meta: { label: "Code" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-xs whitespace-nowrap">{row.original.code}</span>,
      },
      {
        id: "type",
        meta: { label: "Type" },
        header: "Type",
        enableSorting: false,
        cell: ({ row }) => <ScenarioTypeBadge type={row.original.type} />,
      },
      {
        id: "creator",
        meta: { label: "Creator" },
        header: "Creator",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.createdBy ?? "Not recorded"}</span>,
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        meta: { label: "Last updated" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last updated" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground" title={formatDate(row.original.updatedAt)}>
            {formatRelative(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "status",
        meta: { label: "Status", align: "right" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <ScenarioStatusBadge status={row.original.status} />,
        enableHiding: false,
      },
    ],
    [],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "type", title: "Type", options: SCENARIO_TYPES.map((o) => ({ ...o })) },
      { key: "status", title: "Status", options: SCENARIO_STATUSES.map((o) => ({ ...o })) },
      { key: "creator", title: "Creator", options: creators },
    ],
    [creators],
  );

  return (
    <DataTable
      id="scenarios"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange={{ label: "Created" }}
      searchPlaceholder="Search name, code, description…"
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/analytics/scenarios/${r.id}`)}
      initialHidden={["code"]}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{r.name}</p>
            <ScenarioStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.code}</span> · {r.createdBy ?? "Not recorded"} · updated {formatRelative(r.updatedAt)}
          </p>
          <ScenarioTypeBadge type={r.type} className="h-5 px-2 text-[11px]" />
        </div>
      )}
      emptyState={
        <EmptyState
          icon={FlaskConical}
          title="No scenarios yet"
          description="A scenario tries out a change, like more demand, a late delivery or a new project, against today's records. It never changes stock, budgets, people or money."
          action={
            mayCreate ? (
              <Button asChild>
                <Link href="/analytics/scenarios/new">
                  <Plus /> New scenario
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
