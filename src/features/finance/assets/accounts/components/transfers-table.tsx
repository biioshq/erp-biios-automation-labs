"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowLeftRight, ArrowRight, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { useCan } from "@/components/current-user";
import { deleteTransfer } from "../actions";
import type { TransferRow } from "../types";
import { bankLineHref } from "@/features/finance/bank-statements/line-href";

function Route({ row }: { row: TransferRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{row.from?.name ?? "Deleted account"}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{row.to?.name ?? "Deleted account"}</span>
    </span>
  );
}

/** Transfers between own accounts, with a confirmed delete for people with Cash & bank delete. */
export function TransfersTable({ rows, canAdd }: { rows: TransferRow[]; canAdd: boolean }) {
  const [deleting, setDeleting] = useState<TransferRow | null>(null);
  const canDelete = useCan("finance.cash_bank:delete");

  async function remove(row: TransferRow) {
    const result = await deleteTransfer({ id: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.message ?? "Transfer deleted");
    emitDataChanged();
    return true;
  }

  const columns = useMemo<ColumnDef<TransferRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(fromDateInput(row.original.date))}</span>,
      },
      {
        id: "route",
        meta: { label: "From and to" },
        header: "From and to",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-56">
            <Route row={row.original} />
            {row.original.reference || row.original.notes ? (
              <p className="truncate text-xs text-muted-foreground">{[row.original.reference, row.original.notes].filter(Boolean).join(" · ")}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} className="font-semibold" />,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.fromStatement ? (
            <span className="flex justify-end gap-1">
              {row.original.bankTransactionIds.map((id, i) => (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>
                    <Link href={bankLineHref(id)} className="inline-flex text-muted-foreground hover:text-brand-ink" aria-label={`Open bank statement line ${i + 1}`}>
                      <FileSpreadsheet className="size-4" aria-hidden />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>From a bank statement line. Open it to unmatch it before deleting the transfer.</TooltipContent>
                </Tooltip>
              ))}
            </span>
          ) : canDelete ? (
            <Button variant="ghost" size="icon-sm" aria-label="Delete transfer" onClick={() => setDeleting(row.original)}>
              <Trash2 />
            </Button>
          ) : null,
      },
    ],
    [canDelete],
  );

  return (
    <>
      <DataTable
        id="account-transfers"
        columns={columns}
        data={rows}
        hideToolbar={rows.length <= 10}
        searchPlaceholder="Search transfers…"
        getRowId={(r) => r.id}
        renderMobileRow={(r) => (
          <div className="min-w-0 space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-sm font-medium">
                <Route row={r} />
              </div>
              <Money value={r.amount} className="shrink-0 font-semibold" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {formatDate(fromDateInput(r.date))}
                {r.reference ? ` · ${r.reference}` : ""}
                {r.fromStatement ? " · from a bank statement" : ""}
              </p>
              {r.fromStatement ? (
                <span className="flex shrink-0 gap-2">
                  {r.bankTransactionIds.map((id, i) => (
                    <Link key={id} href={bankLineHref(id)} className="text-xs font-medium text-brand-ink hover:underline">
                      {r.bankTransactionIds.length > 1 ? `Line ${i + 1}` : "Statement line"}
                    </Link>
                  ))}
                </span>
              ) : canDelete ? (
                <Button variant="ghost" size="icon-sm" className="-my-1 shrink-0" aria-label="Delete transfer" onClick={() => setDeleting(r)}>
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </div>
        )}
        emptyState={
          <EmptyState
            compact
            icon={ArrowLeftRight}
            title="No transfers yet"
            description="Cash deposited in the bank, cash withdrawn for the cash box, or money moved from one bank to another goes here."
            action={
              canAdd ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="?transfer=1" scroll={false}>
                    <Plus /> Record transfer
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this transfer?"
        description={deleting ? `The ${formatDate(fromDateInput(deleting.date))} transfer from ${deleting.from?.name ?? "an account"} to ${deleting.to?.name ?? "an account"} is removed and both balances change back.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
