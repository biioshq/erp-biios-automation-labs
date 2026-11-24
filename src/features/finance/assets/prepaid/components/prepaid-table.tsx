"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarRange } from "lucide-react";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PAYMENT_STATUSES, labelOf, type PaymentStatus } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { PrepaidRow, PrepaidStatus } from "../queries";

const STATUS: Record<PrepaidStatus, { label: string; tone: Tone }> = {
  running: { label: "In use", tone: "info" },
  not_started: { label: "Starts later", tone: "neutral" },
  used_up: { label: "Used up", tone: "success" },
  not_in_books: { label: "Not counted", tone: "warning" },
};
const PAY_TONE: Record<PaymentStatus, Tone> = { paid: "success", partial: "info", unpaid: "neutral", overdue: "danger" };

const day = (d: string) => formatDate(fromDateInput(d));

function Status({ row }: { row: PrepaidRow }) {
  const s = STATUS[row.status];
  const badge = <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
  if (!row.note) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{row.note}</TooltipContent>
    </Tooltip>
  );
}

function Used({ row }: { row: PrepaidRow }) {
  const share = row.prepaidValue > 0 ? Math.min(100, (row.used / row.prepaidValue) * 100) : 0;
  return (
    <div className="min-w-32 space-y-1">
      <Progress value={share} className="h-1.5" aria-label={`${Math.round(share)}% used`} />
      <p className="text-[11px] text-muted-foreground">
        {formatNumber(row.daysUsed)} of {formatNumber(row.days)} days
      </p>
    </div>
  );
}

/** Prepaid expenses with what is used and what is left today. Each opens its expense. */
export function PrepaidTable({ rows }: { rows: PrepaidRow[] }) {
  const columns = useMemo<ColumnDef<PrepaidRow>[]>(
    () => [
      {
        id: "vendor",
        accessorFn: (r) => `${r.vendor} ${r.description ?? ""} ${r.number}`,
        meta: { label: "Expense" },
        header: "Expense",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-48 max-w-72">
            <Link href={`/finance/expenses?view=${row.original.id}`} className="block truncate font-medium hover:underline">
              {row.original.vendor}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{row.original.number}</span> · {row.original.description || row.original.category}
            </p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Paid in advance", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid in advance" align="right" />,
        cell: ({ row }) => (
          <div className="text-right">
            <Money value={row.original.amount} />
            {Math.abs(row.original.amount - row.original.prepaidValue) >= 0.01 && row.original.status !== "not_in_books" ? (
              <p className="text-[11px] text-muted-foreground">
                <Money value={row.original.prepaidValue} /> after GST credit
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "paidOn",
        accessorFn: (r) => r.paidOn ?? "",
        meta: { label: "Payment date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Payment date" />,
        cell: ({ row }) => (
          <div className="whitespace-nowrap">
            <p className="text-muted-foreground">{row.original.paidOn ? day(row.original.paidOn) : "Not paid yet"}</p>
            {row.original.paymentStatus !== "paid" ? (
              <StatusBadge tone={PAY_TONE[row.original.paymentStatus]} dot={false} className="h-5 px-2 text-[11px]">
                {labelOf(PAYMENT_STATUSES, row.original.paymentStatus)}
              </StatusBadge>
            ) : null}
          </div>
        ),
      },
      {
        id: "to",
        accessorKey: "to",
        meta: { label: "Valid" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Valid" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {day(row.original.from)} to {day(row.original.to)}
          </span>
        ),
      },
      {
        id: "used",
        accessorKey: "used",
        meta: { label: "Used so far", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Used so far" align="right" />,
        cell: ({ row }) => (
          <div className="flex flex-col items-end gap-1">
            <Money value={row.original.used} />
            <Used row={row.original} />
          </div>
        ),
      },
      {
        id: "remaining",
        accessorKey: "remaining",
        meta: { label: "Remaining", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Remaining" align="right" />,
        cell: ({ row }) => <Money value={row.original.remaining} className="font-semibold" />,
        enableHiding: false,
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <Status row={row.original} />,
      },
    ],
    [],
  );

  return (
    <DataTable
      id="asset-prepaid"
      columns={columns}
      data={rows}
      pageSize={20}
      searchPlaceholder="Search vendor or description…"
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <Link href={`/finance/expenses?view=${r.id}`} className="block min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-medium">{r.vendor}</p>
            <Money value={r.remaining} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {r.description || r.category} · {day(r.from)} to {day(r.to)}
          </p>
          <p className="text-xs text-muted-foreground">
            <Money value={r.used} /> used of <Money value={r.prepaidValue} /> · {r.paidOn ? `paid ${day(r.paidOn)}` : "not paid yet"}
          </p>
          <Status row={r} />
        </Link>
      )}
      emptyState={
        <EmptyState
          compact
          icon={CalendarRange}
          title="No prepaid expenses"
          description="Insurance, annual licences, rent paid ahead: mark the expense as prepaid with the period it covers, and it shows here with what is left."
        />
      }
    />
  );
}
