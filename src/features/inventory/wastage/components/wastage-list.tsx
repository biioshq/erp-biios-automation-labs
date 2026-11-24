"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { DEPARTMENTS, WASTAGE_REASONS, labelOf } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import { WASTAGE_SOURCES } from "../schemas";
import type { WastageRow } from "../types";

type Option = { value: string; label: string };

function Source({ row }: { row: WastageRow }) {
  if (row.from === "project" && row.project) {
    return (
      <Link href={`/finance/projects/${row.project.id}?tab=inventory`} className="flex min-w-0 items-center gap-1.5 text-sm hover:underline">
        <span className="size-2 shrink-0 rounded-full" style={{ background: row.project.color }} />
        <span className="truncate">{row.project.name}</span>
      </Link>
    );
  }
  return <span className="text-sm text-muted-foreground">{row.from === "project" ? "A project" : "Storage"}</span>;
}

function WastageMobileRow({ w }: { w: WastageRow }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {w.item.id ? (
            <Link href={`/inventory/items/${w.item.id}`} className="block truncate text-[15px] font-medium hover:underline">
              {w.item.name}
            </Link>
          ) : (
            <span className="block truncate text-[15px] font-medium text-muted-foreground">{w.item.name}</span>
          )}
          <p className="truncate font-mono text-[11px] text-muted-foreground">{w.item.sku}</p>
        </div>
        <span className="tabular shrink-0 text-base font-semibold whitespace-nowrap text-danger">
          {formatNumber(w.quantity)} <span className="text-xs font-normal text-muted-foreground">{w.item.unit}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <StatusBadge tone="danger">{labelOf(WASTAGE_REASONS, w.reason)}</StatusBadge>
        <span className="tabular text-xs whitespace-nowrap text-muted-foreground">{formatDate(w.date)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <Source row={w} />
        <Money value={w.value} className="shrink-0 font-medium" />
      </div>
      {w.department || w.responsible || w.location ? (
        <p className="truncate text-xs text-muted-foreground">
          {[w.department ? labelOf(DEPARTMENTS, w.department) : null, w.responsible, w.location].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** Recorded wastage, newest first, with the value written off and who answers for it. */
export function WastageList({ data, projects, items }: { data: Paginated<WastageRow>; projects: Option[]; items: Option[] }) {
  const columns = useMemo<ColumnDef<WastageRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span>,
        enableHiding: false,
      },
      {
        id: "item",
        meta: { label: "Item" },
        header: "Item",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-44">
            {row.original.item.id ? (
              <Link href={`/inventory/items/${row.original.item.id}`} className="block truncate font-medium hover:underline">
                {row.original.item.name}
              </Link>
            ) : (
              <span className="block truncate font-medium text-muted-foreground">{row.original.item.name}</span>
            )}
            <p className="truncate font-mono text-[11px] text-muted-foreground">{row.original.item.sku}</p>
          </div>
        ),
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        meta: { label: "Quantity", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quantity" align="right" />,
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap font-semibold">
            {formatNumber(row.original.quantity)} <span className="font-normal text-muted-foreground">{row.original.item.unit}</span>
          </span>
        ),
      },
      {
        id: "reason",
        meta: { label: "Reason" },
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) => <StatusBadge tone="danger">{labelOf(WASTAGE_REASONS, row.original.reason)}</StatusBadge>,
      },
      {
        id: "totalCost",
        accessorKey: "value",
        meta: { label: "Value", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Value" align="right" />,
        cell: ({ row }) => (
          <div className="text-right">
            <Money value={row.original.value} className="font-semibold" />
            {row.original.expense ? (
              <Link href={`/finance/expenses?view=${row.original.expense.id}`} className="block text-[11px] text-muted-foreground hover:underline">
                {row.original.expense.number}
              </Link>
            ) : null}
          </div>
        ),
      },
      {
        id: "from",
        meta: { label: "From" },
        header: "From",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-32">
            <Source row={row.original} />
          </div>
        ),
      },
      {
        id: "department",
        meta: { label: "Department" },
        header: "Department",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">{row.original.department ? labelOf(DEPARTMENTS, row.original.department) : "-"}</span>
        ),
      },
      {
        id: "location",
        meta: { label: "Location" },
        header: "Location",
        enableSorting: false,
        cell: ({ row }) => <span className="block max-w-40 truncate text-muted-foreground">{row.original.location ?? "-"}</span>,
      },
      {
        id: "responsible",
        meta: { label: "Responsible" },
        header: "Responsible",
        enableSorting: false,
        cell: ({ row }) => <span className="block max-w-40 truncate text-muted-foreground">{row.original.responsible ?? "-"}</span>,
      },
      {
        id: "by",
        meta: { label: "Recorded by" },
        header: "Recorded by",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.by ?? "System"}</span>,
      },
      {
        id: "note",
        meta: { label: "Note" },
        header: "Note",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-56 truncate text-muted-foreground" title={row.original.note ?? undefined}>
            {row.original.note ?? ""}
          </span>
        ),
      },
    ],
    [],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "reason", title: "Reason", options: WASTAGE_REASONS.map((o) => ({ value: o.value, label: o.label })) },
      { key: "source", title: "From", options: WASTAGE_SOURCES.map((o) => ({ value: o.value, label: o.label })) },
      { key: "department", title: "Department", options: DEPARTMENTS.map((o) => ({ value: o.value, label: o.label })) },
      { key: "project", title: "Project", options: projects },
      { key: "item", title: "Item", options: items },
    ],
    [projects, items],
  );

  return (
    <DataTable
      id="inventory-wastage"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      renderMobileRow={(w) => <WastageMobileRow w={w} />}
      dateRange
      searchPlaceholder="Search item, person, place, note…"
      getRowId={(r) => r.id}
      initialHidden={["by", "note"]}
      emptyState={
        <EmptyState
          icon={Trash2}
          title="No wastage recorded"
          description="Damaged, expired, lost or scrapped stock recorded above shows up here with its value, reason and who answers for it."
        />
      }
    />
  );
}
