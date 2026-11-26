"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { useCan } from "@/components/current-user";
import { formatDate } from "@/lib/format";
import type { InstalmentStatus, LoanInstalmentRow } from "../loan-instalments";

const STATUS: Record<InstalmentStatus, { label: string; tone: Tone }> = {
  overdue: { label: "Overdue", tone: "danger" },
  due: { label: "Due", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
};

function InstalmentStatusBadge({ status, className }: { status: InstalmentStatus; className?: string }) {
  return (
    <StatusBadge tone={STATUS[status].tone} className={className}>
      {STATUS[status].label}
    </StatusBadge>
  );
}

/** The loan's drawer on the Loans page, where a repayment is recorded (its interest part is saved as an expense). */
const loanHref = (id: string) => `/finance/liabilities/loans?view=${id}`;

/** Loan and borrowing instalments: lender, instalment, next due, balance, and the way to record a repayment. */
export function LoanInstalmentsTable({ rows }: { rows: LoanInstalmentRow[] }) {
  const canRepay = useCan("finance.liabilities:edit");
  const columns = useMemo<ColumnDef<LoanInstalmentRow>[]>(
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
            <InstalmentStatusBadge status={row.original.status} />
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
      id="loan-instalments"
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
            <InstalmentStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
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
