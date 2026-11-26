"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, HandCoins, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { useCan } from "@/components/current-user";
import { formatDate } from "@/lib/format";
import { rhythmLabel } from "@/features/finance/recurring/format";
import type { FixedLoanRow, FixedScheduleRow, FixedStatus } from "../fixed-queries";

const STATUS: Record<FixedStatus | "paused", { label: string; tone: Tone }> = {
  overdue: { label: "Overdue", tone: "danger" },
  due: { label: "Due", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  paused: { label: "Paused", tone: "neutral" },
};

function FixedStatusBadge({ status, className }: { status: FixedStatus | "paused"; className?: string }) {
  return (
    <StatusBadge tone={STATUS[status].tone} className={className}>
      {STATUS[status].label}
    </StatusBadge>
  );
}

const loanHref = (id: string) => `/finance/liabilities/loans?view=${id}`;
const scheduleHref = (id: string) => `/finance/recurring?view=${id}`;

/** Loan and borrowing instalments: lender, instalment, next due, balance, and the way to record a repayment. */
export function FixedLoansTable({ rows }: { rows: FixedLoanRow[] }) {
  const canRepay = useCan("finance.liabilities:edit");
  const columns = useMemo<ColumnDef<FixedLoanRow>[]>(
    () => [
      {
        id: "lender",
        header: "Lender",
        meta: { label: "Lender" },
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={loanHref(row.original.id)} className="block min-w-40 hover:underline">
            <span className="block truncate font-medium">{row.original.lender}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              <span className="font-mono">{row.original.code}</span> · {row.original.name}
            </span>
          </Link>
        ),
      },
      {
        id: "installment",
        header: () => <div className="text-right text-xs">Instalment</div>,
        meta: { label: "Instalment", align: "right" },
        cell: ({ row }) =>
          row.original.installment ? <Money value={row.original.installment} className="font-medium" /> : <span className="text-xs text-muted-foreground">Not set</span>,
      },
      {
        id: "nextDue",
        header: "Next due",
        meta: { label: "Next due" },
        cell: ({ row }) =>
          row.original.nextDue ? (
            <div className="whitespace-nowrap">
              <p className={row.original.status === "overdue" ? "font-medium text-danger" : undefined}>{formatDate(row.original.nextDue)}</p>
              {row.original.nextAmount ? (
                <p className="text-[11px] text-muted-foreground">
                  <Money value={row.original.nextAmount} />
                </p>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No due date</span>
          ),
      },
      {
        id: "outstanding",
        header: () => <div className="text-right text-xs">Remaining</div>,
        meta: { label: "Remaining balance", align: "right" },
        cell: ({ row }) => <Money value={row.original.outstanding} className="font-semibold" />,
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <FixedStatusBadge status={row.original.status} />
            {row.original.overdueCount > 0 ? (
              <p className="pl-1 text-[11px] whitespace-nowrap text-danger">
                <Money value={row.original.overdueAmount} /> late
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        meta: { align: "right" },
        enableHiding: false,
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm">
            <Link href={loanHref(row.original.id)}>
              <HandCoins /> {canRepay ? "Record repayment" : "Open loan"}
            </Link>
          </Button>
        ),
      },
    ],
    [canRepay],
  );
  return (
    <DataTable
      id="fixed-loans"
      columns={columns}
      data={rows}
      hideToolbar
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <Link href={loanHref(r.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.lender}
            </Link>
            {r.installment ? <Money value={r.installment} className="shrink-0 font-semibold" /> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.code}</span> · {r.nextDue ? `next ${formatDate(r.nextDue)}` : "no due date"} · <Money value={r.outstanding} /> left
          </p>
          <div className="flex items-center gap-2">
            <FixedStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
            {r.overdueCount > 0 ? (
              <span className="text-[11px] text-danger">
                <Money value={r.overdueAmount} /> late
              </span>
            ) : null}
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link href={loanHref(r.id)}>
                <HandCoins /> {canRepay ? "Repay" : "Open"}
              </Link>
            </Button>
          </div>
        </div>
      )}
      emptyState={
        <EmptyState
          compact
          icon={Banknote}
          title="No open loans"
          description="Loans and borrowings with a balance show here with their instalments. Add them under Liabilities, Loans & borrowings."
        />
      }
    />
  );
}

/** Recurring schedules that are fixed commitments: amount, rhythm, next due and the last posted bill. */
export function FixedSchedulesTable({ rows }: { rows: FixedScheduleRow[] }) {
  const columns = useMemo<ColumnDef<FixedScheduleRow>[]>(
    () => [
      {
        id: "name",
        header: "Commitment",
        meta: { label: "Commitment" },
        enableHiding: false,
        cell: ({ row }) => (
          <Link href={scheduleHref(row.original.id)} className="block min-w-44 hover:underline">
            <span className="block truncate font-medium">{row.original.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {row.original.vendor} · {row.original.categoryLabel}
              {row.original.byDefault ? " · fixed as rent" : ""}
            </span>
          </Link>
        ),
      },
      {
        id: "amount",
        header: () => <div className="text-right text-xs">Amount</div>,
        meta: { label: "Amount", align: "right" },
        cell: ({ row }) => (
          <div className="text-right">
            <Money value={row.original.amount} className="font-medium" />
            {row.original.frequency !== "monthly" ? (
              <p className="text-[11px] text-muted-foreground">
                <Money value={row.original.monthly} /> a month
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "rhythm",
        header: "Rhythm",
        meta: { label: "Rhythm" },
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">{rhythmLabel(row.original.frequency, row.original.dayOfMonth, row.original.startDate)}</span>
        ),
      },
      {
        id: "next",
        header: "Next due",
        meta: { label: "Next due" },
        cell: ({ row }) =>
          row.original.scheduleStatus === "active" ? (
            <span className="whitespace-nowrap">{formatDate(row.original.nextRunDate)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Paused</span>
          ),
      },
      {
        id: "last",
        header: "Last posted",
        meta: { label: "Last posted" },
        cell: ({ row }) => {
          const last = row.original.lastPosted;
          if (!last) return <span className="text-xs text-muted-foreground">Nothing posted yet</span>;
          return (
            <Link href={`/finance/expenses?view=${last.id}`} className="block whitespace-nowrap hover:underline">
              <span className="block text-sm">{formatDate(last.date)}</span>
              <span className="block text-[11px] text-muted-foreground">
                {last.status === "paid" ? "Paid" : (
                  <>
                    <Money value={last.outstanding} /> outstanding
                  </>
                )}
              </span>
            </Link>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" },
        cell: ({ row }) => <FixedStatusBadge status={row.original.status} />,
      },
    ],
    [],
  );
  return (
    <DataTable
      id="fixed-schedules"
      columns={columns}
      data={rows}
      hideToolbar
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <Link href={scheduleHref(r.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.name}
            </Link>
            <Money value={r.amount} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {r.vendor} · {rhythmLabel(r.frequency, r.dayOfMonth, r.startDate)}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <FixedStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
            {r.scheduleStatus === "active" ? <span>next {formatDate(r.nextRunDate)}</span> : null}
            {r.lastPosted ? (
              <Link href={`/finance/expenses?view=${r.lastPosted.id}`} className="hover:underline">
                last {formatDate(r.lastPosted.date)}, {r.lastPosted.status === "paid" ? "paid" : "outstanding"}
              </Link>
            ) : null}
          </div>
        </div>
      )}
      emptyState={
        <EmptyState
          compact
          icon={Repeat}
          title="No fixed recurring payments"
          description="Rent schedules show here, and any recurring schedule with Fixed commitment switched on."
        />
      }
    />
  );
}
