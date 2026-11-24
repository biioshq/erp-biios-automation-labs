"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, Eye, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { LIABILITY_STATUSES } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import type { Paginated } from "@/lib/list-params";
import type { BankAccountOption } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { DUE_BUCKETS } from "../schemas";
import type { LiabilityListRow } from "../types";
import { LiabilityStatusBadge } from "./liability-badges";
import { LiabilityPanels, useLiabilityPanel } from "./liability-panels";

/** Due date with the next planned instalment under it, when the loan has a schedule. */
export function DueCell({ row }: { row: LiabilityListRow }) {
  return (
    <div className="min-w-28 text-sm">
      <p className="whitespace-nowrap">{row.dueDate ? formatDate(row.dueDate) : <span className="text-muted-foreground">No due date</span>}</p>
      {row.nextInstallment ? (
        <p className={row.nextInstallment.late ? "text-xs whitespace-nowrap text-danger" : "text-xs whitespace-nowrap text-muted-foreground"}>
          Next EMI {formatDate(row.nextInstallment.date)}
          {row.nextInstallment.late ? ", not covered" : ""}
        </p>
      ) : null}
    </div>
  );
}

export function LoansView({
  data,
  groups,
  accounts,
  lenders,
  groupFilter,
  categories,
}: {
  data: Paginated<LiabilityListRow>;
  groups: GroupOption[];
  accounts: BankAccountOption[];
  lenders: string[];
  groupFilter: { value: string; label: string }[];
  /** Expense categories, for when the form is switched to another obligation that is an expense not paid yet. */
  categories?: { value: string; label: string }[];
}) {
  const { setPanel } = useLiabilityPanel();

  const columns = useMemo<ColumnDef<LiabilityListRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Loan" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Loan" />,
        cell: ({ row }) => (
          <div className="flex min-w-52 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-muted-foreground">
              <Banknote className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono">{row.original.code}</span> · {row.original.lender}
              </p>
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "group",
        meta: { label: "Group" },
        header: "Group",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-32 text-sm">
            <p className="truncate">{row.original.groupLabel}</p>
            <p className="text-xs text-muted-foreground">{row.original.current ? "Current" : "Non-current"}</p>
          </div>
        ),
      },
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Taken on" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Taken on" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span>,
      },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        meta: { label: "Due" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) => <DueCell row={row.original} />,
      },
      {
        id: "interestRate",
        accessorKey: "interestRate",
        meta: { label: "Rate", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rate" align="right" />,
        cell: ({ row }) =>
          row.original.interestRate !== null ? <span className="tabular whitespace-nowrap">{formatNumber(row.original.interestRate)}%</span> : <span className="text-xs text-muted-foreground">None</span>,
      },
      {
        id: "originalAmount",
        accessorKey: "originalAmount",
        meta: { label: "Loan amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Loan amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.originalAmount} />,
      },
      {
        id: "principalPaid",
        meta: { label: "Principal repaid", align: "right" },
        header: "Principal repaid",
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.principalPaid} className="text-muted-foreground" />,
      },
      {
        id: "interestPaid",
        meta: { label: "Interest paid", align: "right" },
        header: "Interest paid",
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.interestPaid} className="text-muted-foreground" />,
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
        cell: ({ row }) => <LiabilityStatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Loan actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="font-mono text-xs">{row.original.code}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPanel({ kind: "view", id: row.original.id })}>
                  <Eye /> View and repay
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel({ kind: "edit", id: row.original.id })}>
                  <Pencil /> Edit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [setPanel],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "status", title: "Status", options: LIABILITY_STATUSES.map((o) => ({ ...o })) },
      { key: "due", title: "Due", options: DUE_BUCKETS.map((o) => ({ ...o })) },
      { key: "lender", title: "Lender", options: lenders.map((l) => ({ value: l, label: l })) },
      { key: "group", title: "Group", options: groupFilter },
    ],
    [lenders, groupFilter],
  );

  return (
    <>
      <DataTable
        id="liability-loans"
        mode="server"
        columns={columns}
        data={data.rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={filters}
        dateRange={{ label: "Taken on" }}
        searchPlaceholder="Search loan, code, lender…"
        getRowId={(r) => r.id}
        onRowClick={(r) => setPanel({ kind: "view", id: r.id })}
        initialHidden={["interestPaid"]}
        renderMobileRow={(r) => (
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate font-medium">{r.name}</p>
              <Money value={r.outstanding} className="shrink-0 font-semibold" />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{r.code}</span> · {r.lender} · of <Money value={r.originalAmount} />
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <LiabilityStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
              {r.dueDate ? <span>Due {formatDate(r.dueDate)}</span> : null}
              {r.nextInstallment ? <span className={r.nextInstallment.late ? "text-danger" : undefined}>Next EMI {formatDate(r.nextInstallment.date)}</span> : null}
            </div>
          </div>
        )}
        emptyState={
          <EmptyState
            icon={Banknote}
            title="No loans recorded"
            description="Add each bank loan, business loan or other borrowing with its lender, amount and terms. Repayments then reduce it, and their interest shows in Expenses."
            action={
              <Button onClick={() => setPanel({ kind: "new", group: null })}>
                <Plus /> Add loan
              </Button>
            }
          />
        }
      />
      <LiabilityPanels groups={groups} accounts={accounts} lenders={lenders} defaultKind="loan" categories={categories} />
    </>
  );
}
