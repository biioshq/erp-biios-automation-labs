"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { DataTable, DataTableColumnHeader, facetFilterFn } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { PAYMENT_STATUSES, labelOf, type PaymentStatus } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";

/** Receivable invoice row as the page sends it (dates "yyyy-mm-dd"). */
export type ReceivableTableRow = {
  id: string;
  number: string;
  client: string;
  projectName: string | null;
  projectColor: string | null;
  date: string;
  dueDate: string | null;
  total: number;
  received: number;
  outstanding: number;
  status: PaymentStatus;
};

const TONE: Record<PaymentStatus, Tone> = { paid: "success", partial: "info", unpaid: "neutral", overdue: "danger" };
const RECEIVED_LABEL: Record<PaymentStatus, string> = { paid: "Received", partial: "Partly received", unpaid: "Not received", overdue: "Overdue" };

export function ReceivableStatusBadge({ status }: { status: PaymentStatus }) {
  return <StatusBadge tone={TONE[status]}>{RECEIVED_LABEL[status] ?? labelOf(PAYMENT_STATUSES, status)}</StatusBadge>;
}

const day = (d: string | null) => (d ? formatDate(fromDateInput(d)) : null);

/** Open invoices, overdue first. Each opens on the Invoices page. */
export function ReceivablesTable({ rows }: { rows: ReceivableTableRow[] }) {
  const columns = useMemo<ColumnDef<ReceivableTableRow>[]>(
    () => [
      {
        id: "client",
        accessorKey: "client",
        meta: { label: "Customer" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => (
          <div className="min-w-44">
            <Link href={`/finance/invoices?view=${row.original.id}`} className="block truncate font-medium hover:underline">
              {row.original.client}
            </Link>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {row.original.number}
              {row.original.projectName ? <span className="font-sans"> · {row.original.projectName}</span> : null}
            </p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Invoice date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{day(row.original.date)}</span>,
      },
      {
        id: "dueDate",
        accessorFn: (r) => r.dueDate ?? "",
        meta: { label: "Due date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{day(row.original.dueDate) ?? "No due date"}</span>,
      },
      {
        id: "total",
        accessorKey: "total",
        meta: { label: "Amount receivable", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount receivable" align="right" />,
        cell: ({ row }) => <Money value={row.original.total} />,
      },
      {
        id: "received",
        accessorKey: "received",
        meta: { label: "Received", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Received" align="right" />,
        cell: ({ row }) => <Money value={row.original.received} tone={row.original.received > 0 ? "positive" : undefined} />,
      },
      {
        id: "outstanding",
        accessorKey: "outstanding",
        meta: { label: "Outstanding", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Outstanding" align="right" />,
        cell: ({ row }) => <Money value={row.original.outstanding} className="font-semibold" />,
        enableHiding: false,
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        filterFn: facetFilterFn,
        cell: ({ row }) => <ReceivableStatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  return (
    <DataTable
      id="asset-receivables"
      columns={columns}
      data={rows}
      pageSize={20}
      searchPlaceholder="Search customer or invoice…"
      filters={[{ key: "status", title: "Status", options: [{ value: "overdue", label: "Overdue" }, { value: "partial", label: "Partly received" }, { value: "unpaid", label: "Not received" }] }]}
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <Link href={`/finance/invoices?view=${r.id}`} className="block min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{r.client}</p>
            <Money value={r.outstanding} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.number}</span> · {r.dueDate ? `due ${day(r.dueDate)}` : "no due date"} · <Money value={r.received} /> of <Money value={r.total} /> received
          </p>
          <ReceivableStatusBadge status={r.status} />
        </Link>
      )}
      emptyState={
        <EmptyState
          compact
          icon={FileText}
          title="Nothing is owed on invoices"
          description="Invoices with money still to receive show here, overdue ones first. Raise invoices on the Invoices page and link the income you receive to them."
        />
      }
    />
  );
}
