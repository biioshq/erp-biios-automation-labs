"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AUDIT_SOURCES, type AuditRow } from "@/lib/audit";
import { AuditActionBadge, AuditChanges } from "./audit-parts";

function RecordCell({ row }: { row: AuditRow }) {
  return (
    <div className="min-w-48 space-y-0.5">
      {row.href ? (
        <Link href={row.href} className="font-medium break-words hover:underline" onClick={(e) => e.stopPropagation()}>
          {row.entityLabel}
        </Link>
      ) : (
        <p className="font-medium break-words">{row.entityLabel}</p>
      )}
      <p className="text-[11px] text-muted-foreground">{row.entityTypeLabel}</p>
    </div>
  );
}

function ChangesCell({ row }: { row: AuditRow }) {
  if (!row.changes.length && !row.note) return <span className="text-xs text-muted-foreground">No field changes</span>;
  return (
    <div className="max-w-md min-w-56 space-y-1">
      <AuditChanges changes={row.changes} />
      {row.note ? <p className="text-xs break-words text-muted-foreground">{row.note}</p> : null}
    </div>
  );
}

/** The Audit trail list: newest first, filtered by record type, action, person, source and date. */
export function AuditView({ data, actors, types }: { data: Paginated<AuditRow>; actors: { value: string; label: string }[]; types: string[] }) {
  const columns = useMemo<ColumnDef<AuditRow>[]>(
    () => [
      {
        id: "at",
        accessorKey: "at",
        meta: { label: "When" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.at)}</span>,
        enableHiding: false,
      },
      {
        id: "actor",
        meta: { label: "Person" },
        header: "Person",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.actor}</span>,
      },
      {
        id: "action",
        meta: { label: "Action" },
        header: "Action",
        enableSorting: false,
        cell: ({ row }) => <AuditActionBadge action={row.original.action} label={row.original.actionLabel} />,
      },
      {
        id: "record",
        meta: { label: "Record" },
        header: "Record",
        enableSorting: false,
        cell: ({ row }) => <RecordCell row={row.original} />,
        enableHiding: false,
      },
      {
        id: "changes",
        meta: { label: "What changed" },
        header: "What changed",
        enableSorting: false,
        cell: ({ row }) => <ChangesCell row={row.original} />,
      },
      {
        id: "source",
        meta: { label: "Source" },
        header: "Source",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.sourceLabel}</span>,
      },
    ],
    [],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      // Only the record types this person may open.
      { key: "type", title: "Record", options: AUDIT_ENTITY_TYPES.filter((o) => types.includes(o.value)).map((o) => ({ ...o })) },
      { key: "action", title: "Action", options: AUDIT_ACTIONS.map((o) => ({ ...o })) },
      { key: "actor", title: "Person", options: actors },
      { key: "source", title: "Source", options: AUDIT_SOURCES.map((o) => ({ ...o })) },
    ],
    [actors, types],
  );

  return (
    <DataTable
      id="audit"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange
      searchPlaceholder="Search record, number or person…"
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <RecordCell row={r} />
            </div>
            <AuditActionBadge action={r.action} label={r.actionLabel} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(r.at)} · {r.actor}
            {r.source !== "manual" ? ` · ${r.sourceLabel}` : ""}
          </p>
          <AuditChanges changes={r.changes} />
          {r.note ? <p className="text-xs break-words text-muted-foreground">{r.note}</p> : null}
        </div>
      )}
      emptyState={
        <EmptyState
          icon={History}
          title="Nothing recorded yet"
          description="Changes to income, expenses, invoices, bank statement lines and categories appear here from now on."
          compact
        />
      }
    />
  );
}
