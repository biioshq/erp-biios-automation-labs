"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes, ExternalLink, Paperclip, Plus, Receipt, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { StatusBadge } from "@/components/shared/status-badge";
import { ExpenseForm } from "@/features/finance/expenses/components/expense-form";
import { ExpenseMobileCard, ExpenseSourceBadge } from "@/features/finance/expenses/components/expense-badges";
import type { ExpenseRow } from "@/features/finance/expenses/types";
import { PROJECT_STAGES, labelOf } from "@/lib/constants";
import type { ExpenseCategoryOption } from "@/lib/expense-categories";
import { formatDate, formatNumber } from "@/lib/format";
import type { ProjectOption } from "@/server/lookups";

/** The project's expenses with a stage filter, running totals and the shared expense form in a drawer (?expense=new). */
export function ProjectExpensesTab({
  projectId,
  projectName,
  rows,
  projects,
  vendors,
  categories,
}: {
  projectId: string;
  projectName: string;
  rows: ExpenseRow[];
  projects: ProjectOption[];
  vendors: string[];
  /** Built-in and custom categories for the form (getExpenseCategories). Without them the form offers the built-ins. */
  categories?: ExpenseCategoryOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState("all");
  const open = searchParams.get("expense") === "new";

  const setOpen = (next: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("expense", "new");
    else params.delete("expense");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const visible = useMemo(() => (stage === "all" ? rows : rows.filter((r) => r.stage === stage)), [rows, stage]);
  const total = visible.reduce((s, r) => s + r.amount, 0);
  const fromStock = visible.filter((r) => r.source === "inventory_assignment").reduce((s, r) => s + r.amount, 0);

  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      {
        id: "vendor",
        accessorKey: "vendor",
        meta: { label: "Expense" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expense" />,
        cell: ({ row }) => (
          <div className="flex min-w-48 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-muted-foreground">
              {row.original.source === "inventory_assignment" ? (
                <Boxes className="size-4 text-brand-ink" />
              ) : row.original.source === "recurring" ? (
                <Repeat className="size-4 text-brand-ink" />
              ) : (
                <Receipt className="size-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-medium">
                {row.original.vendor}
                <ExpenseSourceBadge source={row.original.source} className="h-5 px-2 text-[11px]" />
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {row.original.number}
                {row.original.description ? <span className="font-sans"> · {row.original.description}</span> : null}
              </p>
            </div>
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
      {
        id: "stage",
        accessorFn: (r) => r.stage ?? "",
        meta: { label: "Stage" },
        header: "Stage",
        enableSorting: false,
        cell: ({ row }) => (row.original.stage ? labelOf(PROJECT_STAGES, row.original.stage) : <span className="text-muted-foreground">-</span>),
      },
      {
        id: "category",
        accessorKey: "category",
        meta: { label: "Category" },
        header: "Category",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone="neutral" dot={false}>
            {row.original.categoryLabel}
          </StatusBadge>
        ),
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => (
          <span className="inline-flex items-center justify-end gap-1.5">
            {row.original.hasReceipt ? <Paperclip className="size-3.5 text-muted-foreground" aria-label="Has receipt" /> : null}
            <Money value={row.original.amount} className="font-semibold" />
          </span>
        ),
        enableHiding: false,
      },
      {
        id: "open",
        meta: { align: "right", className: "w-10" },
        header: () => <span className="sr-only">Open</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button asChild variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
            <Link href={`/finance/expenses?view=${row.original.id}`} aria-label={`Open ${row.original.number}`}>
              <ExternalLink />
            </Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const addButton = (
    <Button onClick={() => setOpen(true)}>
      <Plus /> Add expense
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card px-4 py-4 shadow-card sm:grid-cols-3 sm:px-5">
        <div className="min-w-0">
          <p className="eyebrow text-[10px]">{stage === "all" ? "All expenses" : labelOf(PROJECT_STAGES, stage as never)}</p>
          <p className="tabular mt-1 text-xl font-semibold">{formatNumber(visible.length)}</p>
        </div>
        <div className="min-w-0">
          <p className="eyebrow text-[10px]">Total</p>
          <Money value={total} className="mt-1 block text-xl font-semibold" />
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <p className="eyebrow text-[10px]">From inventory</p>
          <Money value={fromStock} className="mt-1 block text-xl font-semibold" />
        </div>
      </div>
      {/* Members get the list without salary rows, so their total is lower than an admin's. */}
      <SalariesHiddenNote className="-mt-2" />

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses on this project"
          description="Add an expense, or assign stock from inventory. Both count against the budget."
          action={addButton}
        />
      ) : (
        <DataTable
          id="project-expenses"
          columns={columns}
          data={visible}
          pageSize={20}
          searchPlaceholder="Search vendor, number…"
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/finance/expenses?view=${r.id}`)}
          renderMobileRow={(r) => <ExpenseMobileCard row={r} showProject={false} />}
          toolbarActions={
            <>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger className="h-9 w-full sm:h-8 sm:w-40" aria-label="Filter by stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {PROJECT_STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {addButton}
            </>
          }
          emptyState={<EmptyState compact icon={Receipt} title="No expenses in this stage" />}
        />
      )}

      <FormSheet open={open} onOpenChange={setOpen} size="xl" title="Add expense" description={`Counts against ${projectName}'s budget.`}>
        {open ? (
          <ExpenseForm projects={projects} vendors={vendors} categories={categories} defaultProjectId={projectId} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        ) : null}
      </FormSheet>
    </div>
  );
}
