"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeIndianRupee, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { useCan } from "@/components/current-user";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import { RECEIPT_METHODS } from "../schemas";
import type { InvoicePaymentRow } from "../types";
import { InvoiceStatusBadge } from "./invoice-status-badge";

/** "Payments received": every receipt recorded against an invoice, with what is still pending on that invoice. */
export function PaymentsView({ data, invoiceClients }: { data: Paginated<InvoicePaymentRow>; invoiceClients: string[] }) {
  const router = useRouter();
  // The receipt PDF is an income record document: it needs the income view permission (the route checks it too).
  const canDownload = useCan("finance.income:view");
  const columns = useMemo<ColumnDef<InvoicePaymentRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span>,
      },
      {
        id: "client",
        accessorKey: "client",
        meta: { label: "Customer" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Customer" />,
        cell: ({ row }) => (
          <div className="min-w-40">
            <p className="truncate font-medium">{row.original.client}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{row.original.number}</p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "invoice",
        meta: { label: "Invoice" },
        header: "Invoice",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.invoice ? (
            <Link
              href={`/finance/invoices?view=${row.original.invoice.id}`}
              onClick={(e) => e.stopPropagation()}
              className="whitespace-nowrap font-mono text-xs font-medium hover:underline"
            >
              {row.original.invoice.number}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Missing</span>
          ),
      },
      {
        id: "paymentMethod",
        meta: { label: "Mode" },
        header: "Mode",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <p className="text-sm">{labelOf(PAYMENT_METHODS, row.original.paymentMethod)}</p>
            {row.original.reference ? <p className="font-mono text-[11px] text-muted-foreground">{row.original.reference}</p> : null}
          </div>
        ),
      },
      {
        id: "project",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.project ? (
            <p className="flex min-w-32 items-center gap-1.5 truncate text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} />
              {row.original.project.name}
            </p>
          ) : (
            <span className="text-xs text-muted-foreground">No project</span>
          ),
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Received", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Received" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} tone="positive" className="font-semibold" />,
        enableHiding: false,
      },
      {
        id: "pending",
        meta: { label: "Pending on invoice", align: "right" },
        header: () => <span className="whitespace-nowrap">Pending on invoice</span>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.invoice ? (
            <div className="flex flex-col items-end gap-1">
              <Money value={row.original.invoice.outstanding} className="font-medium" />
              <InvoiceStatusBadge status={row.original.invoice.status} className="h-5 px-2 text-[11px]" />
            </div>
          ) : null,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          canDownload ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon-sm" asChild>
                <a href={`/api/documents/receipt/${row.original.id}`} aria-label={`Download receipt ${row.original.number}`} title="Download receipt">
                  <Download />
                </a>
              </Button>
            </div>
          ) : null,
      },
    ],
    [canDownload],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "client", title: "Customer", options: invoiceClients.map((c) => ({ value: c, label: c })) },
      { key: "paymentMethod", title: "Mode", options: RECEIPT_METHODS.map((o) => ({ ...o })) },
    ],
    [invoiceClients],
  );

  return (
    <DataTable
      id="invoice-payments"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange={{ label: "Payment date" }}
      searchPlaceholder="Search customer or invoice…"
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/finance/income?view=${r.id}`)}
      initialHidden={["project"]}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{r.client}</p>
            <Money value={r.amount} tone="positive" className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {formatDate(r.date)} · {labelOf(PAYMENT_METHODS, r.paymentMethod)}
            {r.invoice ? <span className="font-mono"> · {r.invoice.number}</span> : null}
          </p>
          {r.invoice ? (
            <p className="text-xs text-muted-foreground">
              Pending on invoice: <Money value={r.invoice.outstanding} className="font-medium text-foreground" />
            </p>
          ) : null}
          {canDownload ? (
            <a
              href={`/api/documents/receipt/${r.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline"
            >
              <Download className="size-3.5" /> Download receipt
            </a>
          ) : null}
        </div>
      )}
      emptyState={
        <EmptyState
          icon={BadgeIndianRupee}
          title="No payments recorded against invoices yet"
          description="Open an invoice and use Record payment received, or link the invoice when you record income."
        />
      }
    />
  );
}
