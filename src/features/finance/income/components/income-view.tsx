"use client";

import { useEffect, useMemo, useOptimistic, useState, startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { BadgeIndianRupee, Download, Eye, MoreHorizontal, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
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
import { INCOME_CATEGORIES, PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { Paginated } from "@/lib/list-params";
import type { ProjectOption } from "@/server/lookups";
import { deleteIncome, fetchIncome } from "../actions";
import type { IncomeDetail, IncomeRow, IncomeSummary } from "../types";
import { IncomeForm } from "./income-form";
import { IncomeDetailSkeleton, IncomeDetailView } from "./income-detail";

type Panel = { kind: "new" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | null;

/**
 * The income list with its create / view / edit drawers. Drawers follow the
 * URL (?new=1, ?view=<id>, ?edit=<id>) so the command palette and the dashboard can link to them.
 */
export function IncomeView({
  data,
  projects,
  clients,
}: {
  data: Paginated<IncomeRow> & { summary: IncomeSummary };
  projects: ProjectOption[];
  clients: string[];
}) {
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, removeRow] = useOptimistic(data.rows, (state, id: string) => state.filter((r) => r.id !== id));
  const [detail, setDetail] = useState<IncomeDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deleting, setDeleting] = useState<IncomeRow | null>(null);

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
  useEffect(() => {
    if (!panelId) return;
    if (detail?.id === panelId) return;
    let cancelled = false;
    setLoadingDetail(true);
    fetchIncome(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That income record no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .finally(() => !cancelled && setLoadingDetail(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  async function remove(row: Pick<IncomeRow, "id" | "number">) {
    startTransition(() => removeRow(row.id));
    const result = await deleteIncome({ id: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${row.number} deleted`);
    emitDataChanged();
    if (panelId === row.id) setPanel(null);
    return true;
  }

  const columns = useMemo<ColumnDef<IncomeRow>[]>(
    () => [
      {
        id: "client",
        accessorKey: "client",
        meta: { label: "Client" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Client" />,
        cell: ({ row }) => (
          <div className="flex min-w-48 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-success">
              <BadgeIndianRupee className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.client}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {row.original.number}
                {row.original.reference ? <span> · {row.original.reference}</span> : null}
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
            <p className="flex min-w-36 items-center gap-1.5 truncate text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} />
              {row.original.project.name}
            </p>
          ) : (
            <span className="text-xs text-muted-foreground">No project</span>
          ),
      },
      {
        id: "category",
        accessorKey: "category",
        meta: { label: "Category" },
        header: "Category",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone="neutral" dot={false}>
            {labelOf(INCOME_CATEGORIES, row.original.category)}
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
        id: "amount",
        accessorKey: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} tone="positive" className="font-semibold" />,
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
                <Button variant="ghost" size="icon-sm" aria-label="Income actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="font-mono text-xs">{row.original.number}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPanel({ kind: "view", id: row.original.id })}>
                  <Eye /> View
                </DropdownMenuItem>
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
      { key: "category", title: "Category", options: INCOME_CATEGORIES.map((o) => ({ ...o })) },
      {
        key: "project",
        title: "Project",
        options: [{ value: "none", label: "No project" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
      },
      { key: "paymentMethod", title: "Payment", options: PAYMENT_METHODS.filter((o) => o.value !== "stock").map((o) => ({ ...o })) },
    ],
    [projects],
  );

  const exportHref = (format: string) => {
    const params = new URLSearchParams(searchParams.toString());
    ["new", "view", "edit", "page", "size", "sort"].forEach((k) => params.delete(k));
    params.set("format", format);
    return `/api/reports/income?${params.toString()}`;
  };

  const editing = panel?.kind === "edit";

  return (
    <>
      <DataTable
        id="income"
        mode="server"
        columns={columns}
        data={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={filters}
        dateRange
        searchPlaceholder="Search client, number, reference…"
        getRowId={(r) => r.id}
        onRowClick={(r) => setPanel({ kind: "view", id: r.id })}
        renderMobileRow={(r) => (
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate font-medium">{r.client}</p>
              <Money value={r.amount} tone="positive" className="shrink-0 font-semibold" />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{r.number}</span> · {formatDate(r.date)}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              {r.project ? (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: r.project.color }} aria-hidden />
                  <span className="truncate">{r.project.name}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No project</span>
              )}
              <StatusBadge tone="neutral" dot={false} className="h-5 px-2 text-[11px]">
                {labelOf(INCOME_CATEGORIES, r.category)}
              </StatusBadge>
            </div>
          </div>
        )}
        initialHidden={["paymentMethod"]}
        toolbarActions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Download className="opacity-70" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">Filtered income</DropdownMenuLabel>
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
            icon={BadgeIndianRupee}
            title="No income recorded yet"
            description="Record the first payment you received from a client. Link it to a project to see what has been paid against the budget."
            action={
              <Button onClick={() => setPanel({ kind: "new" })}>
                <Plus /> Record income
              </Button>
            }
          />
        }
      />

      <FormSheet
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        size={panel?.kind === "view" ? "md" : "lg"}
        title={panel?.kind === "new" ? "Record income" : editing ? "Edit income" : (detail?.client ?? "Income")}
        description={
          panel?.kind === "new"
            ? "A payment received from a client."
            : editing
              ? detail?.number
              : detail
                ? `${detail.number} · ${formatDate(detail.date)}`
                : undefined
        }
      >
        {panel?.kind === "new" ? (
          <IncomeForm projects={projects} clients={clients} onDone={() => setPanel(null)} onCancel={() => setPanel(null)} />
        ) : panel && (loadingDetail || detail?.id !== panel.id) ? (
          <IncomeDetailSkeleton />
        ) : panel?.kind === "edit" && detail ? (
          <IncomeForm
            key={detail.updatedAt}
            income={detail}
            projects={projects}
            clients={clients}
            onDone={(id) => {
              setDetail(null);
              setPanel({ kind: "view", id });
            }}
            onCancel={() => setPanel({ kind: "view", id: detail.id })}
          />
        ) : panel?.kind === "view" && detail ? (
          <IncomeDetailView income={detail} onEdit={() => setPanel({ kind: "edit", id: detail.id })} onDelete={() => remove(detail)} canDelete={isAdmin} />
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this income record?"
        description={deleting ? `${deleting.number} from ${deleting.client} and its receipt will be removed.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
