"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { PAYMENT_STATUSES } from "@/lib/constants";
import { expenseCategoryFilterOptions, type ExpenseCategoryOption } from "@/lib/expense-categories";
import { formatDate } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import type { BankAccountOption } from "@/server/lookups";
import type { PaymentDefaults } from "../payment-queries";
import { takesPayments } from "../sources";
import type { ExpenseRow } from "../types";
import { BankMarker, ExpenseMobileCard, ExpenseSourceBadge, PaymentStateCell } from "./expense-badges";
import { MarkPaidButton } from "./mark-paid";

const viewHref = (id: string) => `/finance/expenses?view=${id}`;

/** The due date of what is still owed, or "No due date" (the status then counts from the purchase date). */
function DueCell({ row }: { row: ExpenseRow }) {
  if (row.payment.outstanding <= 0) return <span className="text-muted-foreground/60">-</span>;
  if (!row.dueDate) return <span className="text-xs whitespace-nowrap text-muted-foreground">No due date</span>;
  return (
    <span className={cn("whitespace-nowrap", row.payment.status === "overdue" ? "font-medium text-danger" : "text-muted-foreground")}>{formatDate(row.dueDate)}</span>
  );
}

/**
 * One-off purchases of goods: vendor, what was bought, when, what it cost, paid and owed, and Mark as
 * paid on the ones still owed. Filters and paging follow the URL, as on Total expenses.
 */
export function FixedPurchasesTable({
  data,
  vendors,
  categories,
  accounts,
  defaults,
}: {
  data: Paginated<ExpenseRow>;
  vendors: string[];
  categories: ExpenseCategoryOption[];
  accounts: BankAccountOption[];
  defaults: PaymentDefaults;
}) {
  const router = useRouter();
  const canPay = useCan("finance.payments:create");
  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      {
        id: "vendor",
        accessorKey: "vendor",
        meta: { label: "Vendor" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-40">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <span className="truncate">{row.original.vendor}</span>
              {row.original.fromBank ? <BankMarker /> : null}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              <span className="font-mono">{row.original.number}</span> · {row.original.categoryLabel}
            </p>
          </div>
        ),
      },
      {
        id: "description",
        meta: { label: "Description" },
        header: "Description",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="max-w-64 min-w-40">
            <p className="truncate text-sm">{row.original.description || <span className="text-muted-foreground">No description</span>}</p>
            {row.original.source === "inventory_purchase" ? <ExpenseSourceBadge source={row.original.source} className="mt-0.5 h-5 px-2 text-[11px]" /> : null}
          </div>
        ),
      },
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span>,
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        enableHiding: false,
        cell: ({ row }) => <Money value={row.original.amount} className="block text-right font-semibold" />,
      },
      {
        id: "paid",
        meta: { label: "Paid", align: "right" },
        header: () => <div className="text-right text-xs">Paid</div>,
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.payment.paid} className="block text-right text-muted-foreground" />,
      },
      {
        id: "owed",
        meta: { label: "Owed", align: "right" },
        header: () => <div className="text-right text-xs">Owed</div>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.payment.outstanding > 0 ? (
            <Money value={row.original.payment.outstanding} className="block text-right font-medium" />
          ) : (
            <span className="block text-right text-muted-foreground/60">-</span>
          ),
      },
      {
        id: "due",
        meta: { label: "Due date" },
        header: "Due",
        enableSorting: false,
        cell: ({ row }) => <DueCell row={row.original} />,
      },
      {
        id: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <PaymentStateCell payment={row.original.payment} showMethod />,
      },
      {
        id: "project",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.project ? (
            <span className="inline-flex max-w-44 items-center gap-1.5 text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} aria-hidden />
              <span className="truncate">{row.original.project.name}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Overhead</span>
          ),
      },
      {
        id: "actions",
        meta: { align: "right" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => <RowActions row={row.original} accounts={accounts} defaults={defaults} canPay={canPay} />,
      },
    ],
    [accounts, defaults, canPay],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "status", title: "Payment status", options: PAYMENT_STATUSES.map((o) => (o.value === "unpaid" ? { value: o.value, label: "Outstanding (nothing paid)" } : { ...o })) },
      { key: "category", title: "Category", options: expenseCategoryFilterOptions(categories) },
      { key: "vendor", title: "Vendor", options: vendors.map((v) => ({ value: v, label: v })) },
    ],
    [categories, vendors],
  );

  return (
    <DataTable
      id="fixed-purchases"
      mode="server"
      columns={columns}
      data={data.rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange
      searchPlaceholder="Search vendor, invoice, number…"
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(viewHref(r.id))}
      renderMobileRow={(r) => (
        <div className="space-y-2">
          <ExpenseMobileCard row={r} showPaymentState />
          {canPay && takesPayments(r.source) && r.payment.outstanding > 0 ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <MarkPaidButton expense={{ id: r.id, number: r.number, vendor: r.vendor, outstanding: r.payment.outstanding, paymentMethod: r.paymentMethod }} accounts={accounts} defaults={defaults} />
            </div>
          ) : null}
        </div>
      )}
      emptyState={
        <EmptyState
          icon={Package}
          title="No one-off purchases"
          description="Materials, equipment, stock purchases and fixed assets bought show here. Regular costs such as rent, bills and loan EMIs are under Recurring expenses."
        />
      }
    />
  );
}

function RowActions({ row, accounts, defaults, canPay }: { row: ExpenseRow; accounts: BankAccountOption[]; defaults: PaymentDefaults; canPay: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {canPay && takesPayments(row.source) && row.payment.outstanding > 0 ? (
        <MarkPaidButton
          expense={{ id: row.id, number: row.number, vendor: row.vendor, outstanding: row.payment.outstanding, paymentMethod: row.paymentMethod }}
          accounts={accounts}
          defaults={defaults}
        />
      ) : null}
      <Button asChild variant="ghost" size="icon-sm" aria-label="Open expense">
        <Link href={viewHref(row.id)}>
          <Eye />
        </Link>
      </Button>
    </div>
  );
}
