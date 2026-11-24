"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Receipt, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader, useTableUrl, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { PAYMENT_METHODS, PAYMENT_STATUSES, labelOf } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import type { BankAccountOption } from "@/server/lookups";
import { RecordPaymentButton } from "@/features/finance/expenses/components/record-payment-dialog";
import { DUE_BUCKETS } from "../schemas";
import type { BillPaymentRow, PayableListRow } from "../types";
import { BillStatusBadge } from "./liability-badges";

type VendorRow = { vendor: string; outstanding: number; bills: number; overdue: number };

const expenseHref = (id: string) => `/finance/expenses?view=${id}`;

/** Unpaid and part-paid bills, with a payment button on each, as a URL-filtered table. */
export function PayablesTable({ data, vendors, accounts }: { data: Paginated<PayableListRow>; vendors: string[]; accounts: BankAccountOption[] }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<PayableListRow>[]>(
    () => [
      {
        id: "vendor",
        accessorKey: "vendor",
        meta: { label: "Vendor" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => (
          <div className="min-w-44">
            <p className="truncate font-medium">{row.original.vendor}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              <span className="font-mono">{row.original.number}</span> · {row.original.categoryLabel}
              {row.original.project ? ` · ${row.original.project.name}` : ""}
            </p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Bill date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span>,
      },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        meta: { label: "Due" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.dueDate ? formatDate(row.original.dueDate) : "None"}</span>,
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Bill amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bill amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} />,
      },
      {
        id: "paid",
        meta: { label: "Paid", align: "right" },
        header: "Paid",
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.paid} className="text-muted-foreground" />,
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
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <BillStatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        meta: { align: "right" },
        header: () => <span className="sr-only">Pay</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RecordPaymentButton
              expense={{ id: row.original.id, number: row.original.number, vendor: row.original.vendor, outstanding: row.original.outstanding }}
              accounts={accounts}
              variant="outline"
              size="sm"
              label="Record payment"
            />
          </div>
        ),
      },
    ],
    [accounts],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "status", title: "Status", options: PAYMENT_STATUSES.filter((s) => s.value !== "paid").map((o) => ({ ...o })) },
      { key: "due", title: "Due", options: DUE_BUCKETS.filter((b) => b.value !== "none").map((o) => ({ ...o })) },
      { key: "vendor", title: "Vendor", options: vendors.map((v) => ({ value: v, label: v })) },
    ],
    [vendors],
  );

  return (
    <DataTable
      id="liability-payables"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange={{ label: "Due date" }}
      searchPlaceholder="Search vendor or expense number…"
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(expenseHref(r.id))}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{r.vendor}</p>
            <Money value={r.outstanding} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.number}</span> · bill <Money value={r.amount} /> · paid <Money value={r.paid} />
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <BillStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
            {r.dueDate ? <span>Due {formatDate(r.dueDate)}</span> : null}
            {/* The dialog renders in a portal, but its clicks still bubble to this card through React. */}
            <div onClick={(e) => e.stopPropagation()}>
              <RecordPaymentButton expense={{ id: r.id, number: r.number, vendor: r.vendor, outstanding: r.outstanding }} accounts={accounts} variant="outline" size="sm" label="Pay" />
            </div>
          </div>
        </div>
      )}
      emptyState={
        <EmptyState
          icon={Receipt}
          title="Nothing owed to suppliers"
          description="Every expense is paid. Expenses saved as On credit, or paid in part, show here until they are paid in full."
          action={
            <Button asChild variant="outline">
              <Link href="/finance/expenses">Go to expenses</Link>
            </Button>
          }
        />
      }
    />
  );
}

/** Outstanding per vendor; picking one filters the bills table to that vendor. */
export function VendorTable({ rows }: { rows: VendorRow[] }) {
  const url = useTableUrl();
  const selected = url.getList("vendor");
  const columns = useMemo<ColumnDef<VendorRow>[]>(
    () => [
      { id: "vendor", accessorKey: "vendor", header: "Vendor", cell: ({ row }) => <span className="font-medium">{row.original.vendor}</span> },
      { id: "bills", header: "Bills", meta: { align: "right" }, cell: ({ row }) => <span className="tabular">{formatNumber(row.original.bills)}</span> },
      { id: "overdue", header: "Overdue", meta: { align: "right" }, cell: ({ row }) => <Money value={row.original.overdue} tone={row.original.overdue > 0 ? "negative" : undefined} /> },
      { id: "outstanding", header: "Outstanding", meta: { align: "right" }, cell: ({ row }) => <Money value={row.original.outstanding} className="font-semibold" /> },
    ],
    [],
  );
  if (!rows.length) return <EmptyState compact icon={Store} title="No vendor is owed anything" />;
  return (
    <DataTable
      id="liability-vendors"
      columns={columns}
      data={rows}
      pageSize={10}
      searchPlaceholder="Search vendors…"
      getRowId={(r) => r.vendor}
      rowClassName={(r) => (selected.includes(r.vendor) ? "bg-brand/5" : undefined)}
      onRowClick={(r) => url.set({ vendor: selected.length === 1 && selected[0] === r.vendor ? null : r.vendor })}
      renderMobileRow={(r) => (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.vendor}</p>
            <p className="text-xs text-muted-foreground">
              {r.bills} {r.bills === 1 ? "bill" : "bills"}
              {r.overdue > 0 ? (
                <>
                  {" · "}
                  <Money value={r.overdue} tone="negative" /> overdue
                </>
              ) : null}
            </p>
          </div>
          <Money value={r.outstanding} className="shrink-0 font-semibold" />
        </div>
      )}
    />
  );
}

/** The latest payments recorded against bills. */
export function BillPaymentHistory({ rows }: { rows: BillPaymentRow[] }) {
  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon={Receipt}
        title="No bill payments recorded yet"
        description="Payments recorded against unpaid or part-paid bills list here. Expenses paid in full on their own date have no separate payment to show."
      />
    );
  }
  return (
    <ul className="divide-y">
      {rows.map((p) => (
        <li key={p.key}>
          <Link href={expenseHref(p.expenseId)} className="flex items-start justify-between gap-3 px-1 py-2.5 hover:bg-muted/40">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.vendor}</p>
              <p className="truncate text-xs text-muted-foreground">
                {formatDate(p.date)} · <span className="font-mono">{p.number}</span> · {labelOf(PAYMENT_METHODS, p.paymentMethod)}
                {p.reference ? <span className="font-mono"> · {p.reference}</span> : null}
              </p>
            </div>
            <Money value={p.amount} className="shrink-0 text-sm font-semibold" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
