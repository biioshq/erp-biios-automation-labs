"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight, Download, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { MovementTypeBadge } from "@/components/shared/status-badge";
import { MOVEMENT_TYPES, PROJECT_STAGES, WASTAGE_REASONS, labelOf } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Paginated } from "@/lib/list-params";
import type { MovementRow } from "../types";

type Option = { value: string; label: string };

/**
 * The change to available stock, signed. Moves of location and wastage on a project leave storage
 * unchanged, so their units show unsigned and muted.
 */
function QuantityChange({ m, className }: { m: MovementRow; className?: string }) {
  const delta = m.availableDelta;
  return (
    <span className={cn("tabular whitespace-nowrap font-semibold", delta > 0 ? "text-success" : delta === 0 ? "text-muted-foreground" : undefined, className)}>
      {delta > 0 ? "+" : delta < 0 ? "-" : ""}
      {formatNumber(m.quantity)} <span className="text-xs font-normal text-muted-foreground">{m.item.unit}</span>
    </span>
  );
}

/** Wastage reason and source, so a write-off reads without opening anything. */
const wastageNote = (m: MovementRow) =>
  m.wastage ? `${labelOf(WASTAGE_REASONS, m.wastage.reason)}, ${m.wastage.from === "project" ? "in use on the project" : "from storage"}` : null;

/** Where a movement happened besides the stock room: a project, a vendor, a location move. */
function MovementWhere({ m }: { m: MovementRow }) {
  if (m.relocation) {
    return (
      <span className="block max-w-56 truncate text-xs text-muted-foreground" title={`${m.relocation.from ?? "No location"} to ${m.relocation.to ?? "No location"}`}>
        {m.relocation.from ?? "No location"} → <span className="text-foreground">{m.relocation.to ?? "No location"}</span>
      </span>
    );
  }
  const note = wastageNote(m);
  if (!m.project) {
    return (
      <div className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{m.vendor ?? "Stock room"}</span>
        {note ? <p className="truncate text-xs text-danger">{note}</p> : null}
      </div>
    );
  }
  return (
    <div className="min-w-36">
      <Link href={`/finance/projects/${m.project.id}?tab=inventory`} className="flex items-center gap-1.5 truncate text-sm hover:underline">
        <span className="size-2 shrink-0 rounded-full" style={{ background: m.project.color }} />
        {m.project.name}
      </Link>
      {note ? (
        <p className="pl-3.5 text-xs text-danger">{note}</p>
      ) : m.stage ? (
        <p className="pl-3.5 text-xs text-muted-foreground">{labelOf(PROJECT_STAGES, m.stage)}</p>
      ) : null}
    </div>
  );
}

/** One movement as a card on phones: date, item, type, signed quantity and where it went. */
function MovementMobileRow({ m }: { m: MovementRow }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {m.item.id ? (
            <Link href={`/inventory/items/${m.item.id}`} className="block truncate text-[15px] font-medium hover:underline">
              {m.item.name}
            </Link>
          ) : (
            <span className="block truncate text-[15px] font-medium text-muted-foreground">{m.item.name}</span>
          )}
          <p className="truncate font-mono text-[11px] text-muted-foreground">{m.item.sku}</p>
        </div>
        <QuantityChange m={m} className={cn("shrink-0 text-base", m.availableDelta < 0 && "text-danger")} />
      </div>
      {wastageNote(m) ? <p className="text-xs text-danger">{wastageNote(m)}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <MovementTypeBadge type={m.type} />
        <span className="tabular text-xs whitespace-nowrap text-muted-foreground">{formatDate(m.date)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {m.relocation ? (
          <span className="min-w-0 truncate">
            {m.relocation.from ?? "No location"} → {m.relocation.to ?? "No location"}
          </span>
        ) : m.project ? (
          <Link href={`/finance/projects/${m.project.id}?tab=inventory`} className="flex min-w-0 items-center gap-1.5 hover:underline">
            <span className="size-2 shrink-0 rounded-full" style={{ background: m.project.color }} />
            <span className="truncate">{m.project.name}</span>
            {m.wastage ? null : m.stage ? <span className="shrink-0">· {labelOf(PROJECT_STAGES, m.stage)}</span> : null}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{m.vendor ?? "Stock room"}</span>
        )}
        <Money value={m.totalCost} className="shrink-0" />
      </div>
    </div>
  );
}

/** The stock history table: every purchase, assignment, return, adjustment, write-off and location move, newest first. */
export function MovementsView({
  data,
  projects,
  items,
}: {
  data: Paginated<MovementRow>;
  projects: Option[];
  items: Option[];
}) {
  const searchParams = useSearchParams();

  const columns = useMemo<ColumnDef<MovementRow>[]>(
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
        id: "type",
        meta: { label: "Type" },
        header: "Type",
        enableSorting: false,
        cell: ({ row }) => <MovementTypeBadge type={row.original.type} />,
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        meta: { label: "Quantity", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quantity" align="right" />,
        cell: ({ row }) => <QuantityChange m={row.original} />,
      },
      {
        id: "project",
        meta: { label: "Project or place" },
        header: "Project or place",
        enableSorting: false,
        cell: ({ row }) => <MovementWhere m={row.original} />,
      },
      {
        id: "unitCost",
        accessorKey: "unitCost",
        meta: { label: "Unit cost", align: "right" },
        header: () => <div className="text-right text-xs">Unit cost</div>,
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.unitCost} className="text-muted-foreground" />,
      },
      {
        id: "totalCost",
        accessorKey: "totalCost",
        meta: { label: "Total cost", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total cost" align="right" />,
        cell: ({ row }) => <Money value={row.original.totalCost} className="font-semibold" />,
      },
      {
        id: "balance",
        meta: { label: "Balance after", align: "right" },
        header: () => <div className="text-right text-xs">Balance after</div>,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular whitespace-nowrap text-muted-foreground" title="Available / Allocated">
            <span className="text-foreground">{formatNumber(row.original.balance.available)}</span> / {formatNumber(row.original.balance.allocated)}
          </span>
        ),
      },
      {
        id: "by",
        meta: { label: "By" },
        header: "By",
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
      { key: "type", title: "Type", options: MOVEMENT_TYPES.map((o) => ({ ...o })) },
      { key: "project", title: "Project", options: projects },
      { key: "item", title: "Item", options: items },
    ],
    [projects, items],
  );

  const exportHref = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    ["page", "size", "sort"].forEach((k) => params.delete(k));
    params.set("format", format);
    params.set("movements", "1");
    return `/api/reports/inventory?${params.toString()}`;
  };

  return (
    <DataTable
      id="inventory-movements"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      renderMobileRow={(m) => <MovementMobileRow m={m} />}
      dateRange
      searchPlaceholder="Search item, note, vendor…"
      getRowId={(r) => r.id}
      initialHidden={["by", "note"]}
      toolbarActions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 max-md:h-10">
              <Download className="opacity-70" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">Filtered movements</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <a href={exportHref("xlsx")}>Excel (.xlsx)</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={exportHref("csv")}>CSV</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={exportHref("pdf")}>PDF</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      emptyState={
        <EmptyState
          icon={ArrowLeftRight}
          title="No stock movements yet"
          description="Every purchase, assignment, return, adjustment, write-off and location move is recorded here with the balance it left behind."
          action={
            <Button asChild>
              <Link href="/inventory/purchase">
                <PackagePlus /> Purchase stock
              </Link>
            </Button>
          }
        />
      }
    />
  );
}
