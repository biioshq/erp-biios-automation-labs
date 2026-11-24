"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Paperclip } from "lucide-react";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { ENTRY_TONES, entryTypeLabel } from "../labels";
import type { EntryRow } from "../types";
import { useEquityPanel } from "./use-equity-panel";

type Column = "holder" | "reserve" | "payment" | "purpose";

/** What the entry is about, in a few words: who, or which reserve. */
function subject(e: EntryRow): string {
  if (e.holder) return e.holder.name;
  if (e.reserveGroup) return e.reserveGroup.label;
  if (e.type === "dividend") return "All shareholders";
  if (e.type === "opening_retained") return "Before the books started";
  return "";
}

/** Capital entries of one kind or another. A row opens the entry's drawer. */
export function EntriesTable({
  id,
  entries,
  show = ["holder", "payment"],
  emptyState,
  searchPlaceholder = "Search number, name, reference…",
  hideToolbar,
}: {
  id: string;
  entries: EntryRow[];
  show?: Column[];
  emptyState?: React.ReactNode;
  searchPlaceholder?: string;
  hideToolbar?: boolean;
}) {
  const { open } = useEquityPanel();

  const columns = useMemo<ColumnDef<EntryRow>[]>(() => {
    const cols: ColumnDef<EntryRow>[] = [
      {
        id: "number",
        accessorFn: (r) => `${r.number} ${subject(r)} ${r.reference ?? ""} ${r.purpose ?? ""}`,
        meta: { label: "Entry" },
        header: "Entry",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-40 space-y-1">
            <StatusBadge tone={ENTRY_TONES[row.original.type]} dot={false} className="h-5 px-2 text-[11px]">
              {entryTypeLabel(row.original.type)}
              {row.original.type === "capital" && row.original.initial !== null ? (row.original.initial ? " · initial" : " · additional") : ""}
            </StatusBadge>
            <p className="font-mono text-[11px] text-muted-foreground">
              {row.original.number}
              {row.original.reference ? <span> · {row.original.reference}</span> : null}
            </p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span>,
      },
    ];
    if (show.includes("holder") || show.includes("reserve")) {
      cols.push({
        id: "subject",
        accessorFn: subject,
        meta: { label: show.includes("reserve") && !show.includes("holder") ? "Reserve" : "Who" },
        header: show.includes("reserve") && !show.includes("holder") ? "Reserve" : "Who",
        enableSorting: false,
        cell: ({ row }) => <span className="block min-w-32 truncate">{subject(row.original) || <span className="text-muted-foreground">Not recorded</span>}</span>,
      });
    }
    if (show.includes("purpose")) {
      cols.push({
        id: "purpose",
        accessorKey: "purpose",
        meta: { label: "Purpose" },
        header: "Purpose",
        enableSorting: false,
        cell: ({ row }) => <span className="block max-w-64 min-w-32 truncate text-muted-foreground">{row.original.purpose ?? "Not recorded"}</span>,
      });
    }
    if (show.includes("payment")) {
      cols.push({
        id: "payment",
        accessorFn: (r) => r.paymentMethod ?? "",
        meta: { label: "Payment" },
        header: "Payment",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.paymentMethod ? (
            <div className="min-w-28 text-sm">
              <p className="whitespace-nowrap">{labelOf(PAYMENT_METHODS, row.original.paymentMethod)}</p>
              {row.original.account ? <p className="truncate text-xs text-muted-foreground">{row.original.account.name}</p> : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No money moved</span>
          ),
      });
    }
    cols.push(
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} tone={row.original.amount < 0 ? "negative" : undefined} className="font-semibold" />,
        enableHiding: false,
      },
      {
        id: "docs",
        meta: { align: "right", className: "w-10" },
        header: () => <span className="sr-only">Documents</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.documents ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label={`${row.original.documents} documents`}>
              <Paperclip className="size-3.5" />
              {row.original.documents > 1 ? row.original.documents : null}
            </span>
          ) : null,
      },
    );
    return cols;
  }, [show]);

  return (
    <DataTable
      id={id}
      columns={columns}
      data={entries}
      pageSize={20}
      searchPlaceholder={searchPlaceholder}
      hideToolbar={hideToolbar}
      getRowId={(r) => r.id}
      onRowClick={(r) => open({ kind: "viewEntry", id: r.id })}
      emptyState={emptyState}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{subject(r) || entryTypeLabel(r.type)}</p>
            <Money value={r.amount} tone={r.amount < 0 ? "negative" : undefined} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.number}</span> · {formatDate(r.date)}
            {r.paymentMethod ? ` · ${labelOf(PAYMENT_METHODS, r.paymentMethod)}` : ""}
          </p>
          <StatusBadge tone={ENTRY_TONES[r.type]} dot={false} className="h-5 px-2 text-[11px]">
            {entryTypeLabel(r.type)}
          </StatusBadge>
        </div>
      )}
    />
  );
}
