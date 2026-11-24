"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { INVESTOR_INSTRUMENTS, labelOf } from "@/lib/constants";
import { formatDate, initials } from "@/lib/format";
import { HOLDER_KIND_LABELS } from "../labels";
import type { HolderRow } from "../types";
import { useEquityPanel } from "./use-equity-panel";

const percent = (v: number | null) => (v === null ? null : `${Number(v.toFixed(2))}%`);

/**
 * Owners and investors with their totals. `mixed` shows both roles (the summary); otherwise the
 * columns fit the role (drawings for owners, investment type for investors).
 */
export function HoldersTable({ id, holders, mode, emptyState }: { id: string; holders: HolderRow[]; mode: "owner" | "investor" | "mixed"; emptyState?: React.ReactNode }) {
  const { open } = useEquityPanel();

  const columns = useMemo<ColumnDef<HolderRow>[]>(() => {
    const cols: ColumnDef<HolderRow>[] = [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Name" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex min-w-44 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-surface text-xs font-semibold">{initials(row.original.name)}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {mode === "mixed" ? HOLDER_KIND_LABELS[row.original.kind].one : row.original.firstContribution ? `Since ${formatDate(row.original.firstContribution)}` : "No capital yet"}
                {row.original.archived ? " · archived" : ""}
              </p>
            </div>
          </div>
        ),
        enableHiding: false,
      },
    ];
    if (mode === "investor") {
      cols.push({
        id: "instrument",
        accessorFn: (r) => (r.instrument ? labelOf(INVESTOR_INSTRUMENTS, r.instrument) : ""),
        meta: { label: "Investment type" },
        header: "Investment type",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.instrument ? (
            <StatusBadge tone="neutral" dot={false}>
              {labelOf(INVESTOR_INSTRUMENTS, row.original.instrument)}
            </StatusBadge>
          ) : (
            <span className="text-xs text-muted-foreground">Not set</span>
          ),
      });
    }
    const money = (key: "initial" | "additional" | "capital" | "drawings" | "net", title: string): ColumnDef<HolderRow> => ({
      id: key,
      accessorKey: key,
      meta: { label: title, align: "right" },
      header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
      cell: ({ row }) => <Money value={row.original[key]} className={key === "net" ? "font-semibold" : undefined} />,
    });
    cols.push(money("initial", "Initial"), money("additional", "Additional"), money("capital", "Total capital"));
    if (mode !== "investor") cols.push(money("drawings", "Drawings"));
    cols.push(mode === "investor" ? money("net", "Net contributed") : money("net", "Current balance"));
    cols.push({
      id: "ownership",
      accessorFn: (r) => r.ownershipPercent ?? -1,
      meta: { label: "Ownership", align: "right" },
      header: ({ column }) => <DataTableColumnHeader column={column} title="Ownership" align="right" />,
      cell: ({ row }) => <span className="tabular">{percent(row.original.ownershipPercent) ?? <span className="text-xs text-muted-foreground">Not set</span>}</span>,
    });
    return cols;
  }, [mode]);

  return (
    <DataTable
      id={id}
      columns={columns}
      data={holders}
      pageSize={25}
      searchPlaceholder="Search names…"
      getRowId={(r) => r.id}
      onRowClick={(r) => open({ kind: "viewHolder", id: r.id })}
      rowClassName={(r) => (r.archived ? "opacity-60" : undefined)}
      emptyState={emptyState}
      hideToolbar={holders.length <= 8}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">
              {r.name}
              {r.archived ? <span className="text-xs font-normal text-muted-foreground"> · archived</span> : null}
            </p>
            <Money value={r.net} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {mode === "mixed" ? `${HOLDER_KIND_LABELS[r.kind].one} · ` : ""}
            Capital <Money value={r.capital} />
            {r.drawings ? (
              <>
                {" "}
                · drawings <Money value={r.drawings} />
              </>
            ) : null}
            {r.ownershipPercent !== null ? ` · ${percent(r.ownershipPercent)}` : ""}
          </p>
        </div>
      )}
    />
  );
}
