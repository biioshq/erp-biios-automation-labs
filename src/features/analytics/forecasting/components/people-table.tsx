"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { PersonLoad } from "../types";

function LoadText({ value }: { value: number }) {
  return <span className={cn("tabular whitespace-nowrap", value > 100 ? "font-medium text-danger" : value === 0 ? "text-muted-foreground" : undefined)}>{value}%</span>;
}

function Outlook({ p }: { p: PersonLoad }) {
  if (p.status === "on_leave" && p.peak <= 100) return <StatusBadge tone="neutral">On leave</StatusBadge>;
  if (p.peak > 100) return <StatusBadge tone="danger">Over by {p.peak - 100}%</StatusBadge>;
  if (p.peak === 100) return <StatusBadge tone="neutral">Fully allocated</StatusBadge>;
  return <StatusBadge tone="success">{100 - p.peak}% free</StatusBadge>;
}

/** `title` is the short header; `label` the full name in the column menu. */
const pctCol = (id: string, title: string, label: string, pick: (p: PersonLoad) => number): ColumnDef<PersonLoad> => ({
  id,
  accessorFn: pick,
  meta: { label, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => <LoadText value={pick(row.original)} />,
});

/** Each person's allocation now, on upcoming work and at the busiest month ahead. */
export function PeopleTable({ rows, showCost }: { rows: PersonLoad[]; showCost: boolean }) {
  const columns = useMemo<ColumnDef<PersonLoad>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Person" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Person" />,
        cell: ({ row }) => (
          <div className="min-w-40">
            <p className="truncate font-medium">{row.original.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {[row.original.designation, row.original.departmentLabel].filter(Boolean).join(" · ")}
              {/* Status sits here rather than in its own column, so the table fits the page. */}
              {row.original.status === "on_leave" ? <span className="font-medium text-warning"> · On leave</span> : null}
            </p>
          </div>
        ),
        enableHiding: false,
      },
      pctCol("current", "Now", "Allocated now", (p) => p.current),
      pctCol("upcoming", "Upcoming", "On upcoming work", (p) => p.upcoming),
      pctCol("peak", "Busiest month", "Busiest month ahead", (p) => p.peak),
      {
        id: "outlook",
        accessorFn: (p) => p.peak,
        meta: { label: "Shortage or spare" },
        header: "Shortage or spare",
        enableSorting: false,
        cell: ({ row }) => <Outlook p={row.original} />,
      },
      {
        id: "projects",
        accessorFn: (p) => p.projects.length,
        meta: { label: "Projects" },
        header: "Projects",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.projects.length ? (
            <ul className="min-w-40 max-w-xs space-y-0.5 text-xs whitespace-normal">
              {row.original.projects.map((pr) => (
                <li key={`${pr.id}-${pr.role}`}>
                  {pr.name} <span className="text-muted-foreground">· {pr.role} · {pr.allocation}%{pr.upcoming ? " · upcoming" : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">Not on a project</span>
          ),
      },
      ...(showCost
        ? [
            {
              id: "cost",
              accessorFn: (p: PersonLoad) => p.excessMonthlyCost ?? 0,
              meta: { label: "Extra labour cost a month", align: "right" as const },
              header: ({ column }) => <DataTableColumnHeader column={column} title="Extra cost a month" align="right" />,
              cell: ({ row }) => (row.original.excessMonthlyCost ? <Money value={row.original.excessMonthlyCost} /> : <span className="text-muted-foreground">-</span>),
            } satisfies ColumnDef<PersonLoad>,
          ]
        : []),
    ],
    [showCost],
  );
  return (
    <DataTable
      id="forecast-people"
      columns={columns}
      data={rows}
      searchPlaceholder="Search people"
      pageSize={25}
      getRowId={(r) => r.id}
      renderMobileRow={(p) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate text-xs text-muted-foreground">{p.departmentLabel}</p>
            </div>
            <Outlook p={p} />
          </div>
          <p className="tabular text-sm text-muted-foreground">
            Now {p.current}% · upcoming {p.upcoming}% · busiest month {p.peak}%
          </p>
          {p.projects.length ? <p className="truncate text-xs text-muted-foreground">{p.projects.map((pr) => pr.name).join(", ")}</p> : null}
        </div>
      )}
    />
  );
}
