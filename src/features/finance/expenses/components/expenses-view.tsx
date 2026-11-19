"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Boxes, Download, Eye, MoreHorizontal, Paperclip, Pencil, Plus, Receipt, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { useIsAdmin } from "@/components/current-user";
import { useOnLiveChange } from "@/components/live-updates";
import { EXPENSE_CATEGORIES, EXPENSE_SOURCES, PAYMENT_METHODS, PROJECT_STAGES, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { Paginated } from "@/lib/list-params";
import type { ProjectOption } from "@/server/lookups";
import { deleteExpense, fetchExpense } from "../actions";
import type { ExpenseDetail, ExpenseRow, ExpenseSummary } from "../types";
import { ExpenseForm } from "./expense-form";
import { ExpenseDetailSkeleton, ExpenseDetailView } from "./expense-detail";
import { ExpenseMobileCard, ExpenseSourceBadge } from "./expense-badges";

type Panel = { kind: "new" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | null;

/**
 * The expenses list with its create / view / edit drawers. Drawers follow the
 * URL (?new=1, ?view=<id>) so the command palette and other pages can link to them.
 */
export function ExpensesView({
  data,
  projects,
  vendors,
}: {
  data: Paginated<ExpenseRow> & { summary: ExpenseSummary };
  projects: ProjectOption[];
  vendors: string[];
}) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, removeRow] = useOptimistic(data.rows, (state, id: string) => state.filter((r) => r.id !== id));
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // Bumped after a save so the open record is fetched again even when its id has not changed.
  const [version, setVersion] = useState(0);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);

  const panel: Panel = useMemo(() => {
    if (searchParams.get("new") === "1") return { kind: "new" };
    const edit = searchParams.get("edit");
    if (edit) return { kind: "edit", id: edit };
    const view = searchParams.get("view");
    if (view) return { kind: "view", id: view };
    return null;
  }, [searchParams]);

  const setPanel = (next: Panel) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    params.delete("view");
    params.delete("edit");
    if (next?.kind === "new") params.set("new", "1");
    if (next?.kind === "view") params.set("view", next.id);
    if (next?.kind === "edit") params.set("edit", next.id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const panelId = panel && panel.kind !== "new" ? panel.id : null;
  // Closing the drawer drops the cached record, so the next open (and its edit form) shows fresh data.
  if (!panelId && detail) setDetail(null);
  useEffect(() => {
    if (!panelId) return;
    if (detail?.id === panelId) return;
    let cancelled = false;
    setLoadingDetail(true);
    fetchExpense(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That expense no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .finally(() => !cancelled && setLoadingDetail(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, version]);

  // When anyone changes data, reload the open record while it is only being shown, so Edit starts from current
  // figures. Never while the edit form is open: it keeps what is being typed.
  const viewing = useRef<string | null>(null);
  useEffect(() => {
    viewing.current = panel?.kind === "view" ? panel.id : null;
  });
  useOnLiveChange(() => {
    const id = viewing.current;
    if (!id || detail?.id !== id) return;
    fetchExpense(id)
      .then((d) => {
        // Closed, switched to another record or opened for editing meanwhile: leave it.
        if (viewing.current !== id) return;
        if (!d) {
          toast.error("That expense no longer exists.");
          setPanel(null);
          return;
        }
        setDetail(d);
      })
      .catch(() => {
        // Offline: the drawer keeps what it shows and the next change tries again.
      });
  });

  async function remove(row: Pick<ExpenseRow, "id" | "number">) {
    startTransition(() => removeRow(row.id));
    const result = await deleteExpense({ id: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${row.number} deleted`);
    // The drawer showing it closes; it must not be reloaded by the change event below and report it missing.
    if (viewing.current === row.id) viewing.current = null;
    emitDataChanged();
    if (panelId === row.id) setPanel(null);
    return true;
  }

  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      {
        id: "vendor",
        accessorKey: "vendor",
        meta: { label: "Vendor" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
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
              <p className="flex items-center gap-2 font-medium">
                <span className="truncate">{row.original.vendor}</span>
                {row.original.source === "recurring" ? <ExpenseSourceBadge source="recurring" className="h-5 px-2 text-[11px]" /> : null}
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
        id: "project",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.project ? (
            <div className="min-w-36">
              <p className="flex items-center gap-1.5 truncate text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} />
                {row.original.project.name}
              </p>
              {row.original.stage ? (
                <p className="pl-3.5 text-xs text-muted-foreground">{labelOf(PROJECT_STAGES, row.original.stage)}</p>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Overhead</span>
          ),
      },
      {
        id: "category",
        accessorKey: "category",
        meta: { label: "Category" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        cell: ({ row }) => (
          <StatusBadge tone="neutral" dot={false}>
            {labelOf(EXPENSE_CATEGORIES, row.original.category)}
          </StatusBadge>
        ),
      },
      {
        id: "paymentMethod",
        accessorKey: "paymentMethod",
        meta: { label: "Payment" },
        header: "Payment",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{labelOf(PAYMENT_METHODS, row.original.paymentMethod)}</span>,
      },
      {
        id: "gst",
        meta: { label: "GST", align: "right" },
        header: () => <div className="text-right text-xs">GST</div>,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.totalTax > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Money value={row.original.totalTax} className="text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {row.original.gstin ?? "No GSTIN"}
                {row.original.invoiceNumber ? ` · ${row.original.invoiceNumber}` : ""}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-muted-foreground/60">-</span>
          ),
      },
      {
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} className="font-semibold" />,
        enableHiding: false,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {row.original.hasReceipt ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Paperclip className="size-3.5 text-muted-foreground" aria-label="Has receipt" />
                </TooltipTrigger>
                <TooltipContent>Receipt attached</TooltipContent>
              </Tooltip>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Expense actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="font-mono text-xs">{row.original.number}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPanel({ kind: "view", id: row.original.id })}>
                  <Eye /> View
                </DropdownMenuItem>
                {row.original.source !== "inventory_assignment" ? (
                  <>
                    <DropdownMenuItem onSelect={() => setPanel({ kind: "edit", id: row.original.id })}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    {isAdmin ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row.original)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, isAdmin],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "category", title: "Category", options: EXPENSE_CATEGORIES.map((o) => ({ ...o })) },
      {
        key: "project",
        title: "Project",
        options: [{ value: "none", label: "No project (overhead)" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
      },
      { key: "stage", title: "Stage", options: PROJECT_STAGES.map((o) => ({ ...o })) },
      { key: "paymentMethod", title: "Payment", options: PAYMENT_METHODS.map((o) => ({ ...o })) },
      { key: "source", title: "Source", options: EXPENSE_SOURCES.map((o) => ({ ...o })) },
    ],
    [projects],
  );

  const exportHref = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    ["new", "view", "edit", "page", "size", "sort"].forEach((k) => params.delete(k));
    params.set("format", format);
    return `/api/reports/expense?${params.toString()}`;
  };

  const sheetOpen = panel !== null;
  const editing = panel?.kind === "edit";

  return (
    <>
      <DataTable
        id="expenses"
        mode="server"
        columns={columns}
        data={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={filters}
        dateRange
        searchPlaceholder="Search vendor, invoice, number…"
        getRowId={(r) => r.id}
        onRowClick={(r) => setPanel({ kind: "view", id: r.id })}
        renderMobileRow={(r) => <ExpenseMobileCard row={r} />}
        initialHidden={["paymentMethod"]}
        toolbarActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Download className="opacity-70" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Filtered expenses</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <a href={exportHref("xlsx")}>Excel (.xlsx)</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref("csv")}>CSV</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref("pdf")}>PDF</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        emptyState={
          <EmptyState
            icon={Receipt}
            title="No expenses yet"
            description="Add your first expense, or drop a receipt and let OCR fill in the vendor, GSTIN, taxes and totals."
            action={
              <Button onClick={() => setPanel({ kind: "new" })}>
                <Plus /> Add expense
              </Button>
            }
          />
        }
      />

      <FormSheet
        open={sheetOpen}
        onOpenChange={(o) => !o && setPanel(null)}
        size={panel?.kind === "view" ? "md" : "xl"}
        title={panel?.kind === "new" ? "Add expense" : editing ? "Edit expense" : (detail?.vendor ?? "Expense")}
        description={
          panel?.kind === "new"
            ? "Upload the receipt first to fill the form automatically."
            : editing
              ? detail?.number
              : detail
                ? `${detail.number} · ${formatDate(detail.date)}`
                : undefined
        }
      >
        {panel?.kind === "new" ? (
          <ExpenseForm projects={projects} vendors={vendors} onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
        ) : panel && (loadingDetail || detail?.id !== panel.id) ? (
          <ExpenseDetailSkeleton />
        ) : panel?.kind === "edit" && detail ? (
          <ExpenseForm
            // Keyed by the record only: a refresh must never remount the form and drop what is being typed.
            key={detail.id}
            expense={detail}
            projects={projects}
            vendors={vendors}
            onDone={(id) => {
              setDetail(null);
              setVersion((v) => v + 1);
              setPanel({ kind: "view", id });
            }}
            onCancel={() => setPanel({ kind: "view", id: detail.id })}
          />
        ) : panel?.kind === "view" && detail ? (
          <ExpenseDetailView expense={detail} onEdit={() => setPanel({ kind: "edit", id: detail.id })} onDelete={() => remove(detail)} canDelete={isAdmin} />
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this expense?"
        description={deleting ? `${deleting.number} from ${deleting.vendor} and its receipt will be removed.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
