"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, Eye, FileText, MoreHorizontal, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { useOnLiveChange } from "@/components/live-updates";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { emitDataChanged } from "@/lib/events";
import type { Paginated } from "@/lib/list-params";
import type { BankAccountOption, ProjectOption } from "@/server/lookups";
import { deleteInvoice, fetchInvoice, fetchInvoicePrefill, type InvoicePrefill } from "../actions";
import { INVOICE_LIST_STATUSES } from "../schemas";
import type { InvoiceDetail, InvoiceListSummary, InvoiceRow } from "../types";
import { InvoiceForm } from "./invoice-form";
import { InvoiceDetailSkeleton, InvoiceDetailView } from "./invoice-detail";
import { InvoiceStatusBadge } from "./invoice-status-badge";

type Panel = { kind: "new" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | null;

/**
 * The invoice list with its create / view / edit drawers. Drawers follow the URL (?new=1,
 * ?view=<id>, ?edit=<id>) so the accounting reports and the command palette can link to them.
 */
export function InvoicesView({
  data,
  projects,
  clients,
  invoiceClients,
  accounts,
}: {
  data: Paginated<InvoiceRow> & { summary: InvoiceListSummary };
  projects: ProjectOption[];
  /** Known customer names for the form (income and projects). */
  clients: string[];
  /** Customer names on invoices, for the filter. */
  invoiceClients: string[];
  accounts: BankAccountOption[];
}) {
  const canDelete = useCan("finance.invoices:delete");
  const canEdit = useCan("finance.invoices:edit");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, removeRow] = useOptimistic(data.rows, (state, id: string) => state.filter((r) => r.id !== id));
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [version, setVersion] = useState(0);
  const [deleting, setDeleting] = useState<InvoiceRow | null>(null);
  // "Create invoice" on a receipt with no invoice (?new=1&fromIncome=<id>): the form starts from that receipt.
  const fromIncome = searchParams.get("fromIncome");
  const [receiptPrefill, setReceiptPrefill] = useState<InvoicePrefill | null>(null);

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
    params.delete("fromIncome");
    if (next?.kind === "new") params.set("new", "1");
    if (next?.kind === "view") params.set("view", next.id);
    if (next?.kind === "edit") params.set("edit", next.id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const panelId = panel && panel.kind !== "new" ? panel.id : null;
  if (!panelId && detail) setDetail(null);
  const wantedReceipt = panel?.kind === "new" ? fromIncome : null;
  if (!wantedReceipt && receiptPrefill) setReceiptPrefill(null);
  useEffect(() => {
    if (!wantedReceipt || receiptPrefill?.incomeId === wantedReceipt) return;
    let cancelled = false;
    fetchInvoicePrefill({ incomeId: wantedReceipt })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          toast.error(result.error);
          setPanel(null);
          return;
        }
        setReceiptPrefill(result.prefill);
      })
      .catch(() => !cancelled && toast.error("Could not load the receipt. Check the connection and try again."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedReceipt]);
  useEffect(() => {
    if (!panelId) return;
    if (detail?.id === panelId) return;
    let cancelled = false;
    // Until the record arrives the drawer shows a skeleton (detail does not match the panel).
    fetchInvoice(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That invoice no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .catch(() => !cancelled && toast.error("Could not load the invoice. Check the connection and try again."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, version]);

  // Reload the open invoice when anyone changes data, while it is only being shown (never under the edit form).
  const viewing = useRef<string | null>(null);
  useEffect(() => {
    viewing.current = panel?.kind === "view" ? panel.id : null;
  });
  const reloadViewing = () => {
    const id = viewing.current;
    if (!id) return;
    fetchInvoice(id)
      .then((d) => {
        if (viewing.current !== id) return;
        if (!d) {
          toast.error("That invoice no longer exists.");
          setPanel(null);
          return;
        }
        setDetail(d);
      })
      .catch(() => {
        // Offline: the drawer keeps what it shows and the next change tries again.
      });
  };
  useOnLiveChange(() => {
    if (detail?.id === viewing.current) reloadViewing();
  });

  async function remove(row: Pick<InvoiceRow, "id" | "number">) {
    startTransition(() => removeRow(row.id));
    const result = await deleteInvoice({ id: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${row.number} deleted`);
    if (viewing.current === row.id) viewing.current = null;
    emitDataChanged();
    if (panelId === row.id) setPanel(null);
    return true;
  }

  const columns = useMemo<ColumnDef<InvoiceRow>[]>(
    () => [
      {
        id: "number",
        accessorKey: "number",
        meta: { label: "Invoice" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice" />,
        cell: ({ row }) => (
          <div className="flex min-w-48 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-info">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.client}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{row.original.number}</p>
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
        id: "dueDate",
        accessorKey: "dueDate",
        meta: { label: "Due" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) =>
          row.original.dueDate ? (
            <span className={row.original.status === "overdue" ? "whitespace-nowrap font-medium text-danger" : "whitespace-nowrap text-muted-foreground"}>
              {formatDate(row.original.dueDate)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not set</span>
          ),
      },
      {
        id: "project",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.project ? (
            <p className="flex min-w-32 items-center gap-1.5 truncate text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} />
              {row.original.project.name}
            </p>
          ) : (
            <span className="text-xs text-muted-foreground">No project</span>
          ),
      },
      {
        id: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
      },
      {
        id: "total",
        accessorKey: "total",
        meta: { label: "Total", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total" align="right" />,
        cell: ({ row }) => <Money value={row.original.total} className="font-medium" />,
      },
      {
        id: "received",
        meta: { label: "Received", align: "right" },
        header: "Received",
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.received} className="text-muted-foreground" />,
      },
      {
        id: "outstanding",
        accessorKey: "outstanding",
        meta: { label: "Outstanding", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Outstanding" align="right" />,
        cell: ({ row }) => (
          <>
            <Money value={row.original.outstanding} className={row.original.status === "overdue" ? "font-semibold text-danger" : "font-semibold"} />
            {row.original.credit > 0 ? <CreditNote credit={row.original.credit} className="block whitespace-nowrap" /> : null}
          </>
        ),
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
            {row.original.hasFile ? <Paperclip className="size-3.5 text-muted-foreground" aria-label="Invoice file attached" /> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Invoice actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="font-mono text-xs">{row.original.number}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPanel({ kind: "view", id: row.original.id })}>
                  <Eye /> View
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/documents/invoice/${row.original.id}`}>
                    <Download /> Download PDF
                  </a>
                </DropdownMenuItem>
                {row.original.status === "cancelled" || !canEdit ? null : (
                  <DropdownMenuItem onSelect={() => setPanel({ kind: "edit", id: row.original.id })}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                )}
                {canDelete && row.original.received === 0 ? (
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
    [searchParams, canDelete, canEdit],
  );

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "status", title: "Status", options: INVOICE_LIST_STATUSES.map((o) => ({ ...o })) },
      { key: "client", title: "Customer", options: invoiceClients.map((c) => ({ value: c, label: c })) },
      {
        key: "project",
        title: "Project",
        options: [{ value: "none", label: "No project" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
      },
    ],
    [projects, invoiceClients],
  );

  const editing = panel?.kind === "edit";
  const reloadAfterChange = () => {
    setVersion((v) => v + 1);
    setDetail(null);
  };

  return (
    <>
      <DataTable
        id="invoices"
        mode="server"
        columns={columns}
        data={rows}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        filters={filters}
        dateRange={{ label: "Invoice date" }}
        searchPlaceholder="Search number, customer, GSTIN…"
        getRowId={(r) => r.id}
        onRowClick={(r) => setPanel({ kind: "view", id: r.id })}
        rowClassName={(r) => (r.status === "cancelled" ? "opacity-60" : undefined)}
        renderMobileRow={(r) => (
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 truncate font-medium">{r.client}</p>
              <Money value={r.outstanding} className={r.status === "overdue" ? "shrink-0 font-semibold text-danger" : "shrink-0 font-semibold"} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{r.number}</span> · {formatDate(r.date)} · total <Money value={r.total} />
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <InvoiceStatusBadge status={r.status} className="h-5 px-2 text-[11px]" />
              {r.dueDate ? <span className="text-xs text-muted-foreground">Due {formatDate(r.dueDate)}</span> : null}
            </div>
            {r.credit > 0 ? <CreditNote credit={r.credit} className="block" /> : null}
          </div>
        )}
        initialHidden={["project", "received"]}
        emptyState={
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Create the first customer invoice. Payments recorded against it show what the customer has paid and what is still pending."
            action={
              <Button onClick={() => setPanel({ kind: "new" })}>
                <Plus /> New invoice
              </Button>
            }
          />
        }
      />

      <FormSheet
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        size="lg"
        title={panel?.kind === "new" ? "New invoice" : editing ? "Edit invoice" : (detail?.client ?? "Invoice")}
        description={
          panel?.kind === "new"
            ? wantedReceipt
              ? "An invoice for a receipt you already have."
              : "A customer invoice with GST worked out per line."
            : editing
              ? detail?.number
              : detail
                ? `${detail.number} · ${formatDate(detail.date)}`
                : undefined
        }
      >
        {panel?.kind === "new" && wantedReceipt && receiptPrefill?.incomeId !== wantedReceipt ? (
          <InvoiceDetailSkeleton />
        ) : panel?.kind === "new" ? (
          <InvoiceForm
            // Keyed by the receipt, so a form opened for another receipt starts again.
            key={receiptPrefill?.incomeId ?? "new"}
            receipt={wantedReceipt ? receiptPrefill : null}
            projects={projects}
            clients={clients}
            onDone={(id) => setPanel({ kind: "view", id })}
            onCancel={() => setPanel(null)}
          />
        ) : panel && detail?.id !== panel.id ? (
          <InvoiceDetailSkeleton />
        ) : panel?.kind === "edit" && detail ? (
          <InvoiceForm
            key={detail.id}
            invoice={detail}
            projects={projects}
            clients={clients}
            onDone={(id) => {
              reloadAfterChange();
              setPanel({ kind: "view", id });
            }}
            onCancel={() => setPanel({ kind: "view", id: detail.id })}
          />
        ) : panel?.kind === "view" && detail ? (
          <InvoiceDetailView
            invoice={detail}
            accounts={accounts}
            canDelete={canDelete}
            onEdit={() => setPanel({ kind: "edit", id: detail.id })}
            onChanged={reloadViewing}
            onDelete={() => remove(detail)}
          />
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this invoice?"
        description={deleting ? `${deleting.number} to ${deleting.client} and its file will be removed. To keep a record of it, cancel it instead.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}

/** An overpaid invoice: what was received above its total, which the books hold as a customer advance. */
function CreditNote({ credit, className }: { credit: number; className?: string }) {
  return (
    <span className={cn("text-[11px] text-warning", className)} title="Received more than the invoice total. The books hold the extra as a customer advance.">
      <Money value={credit} /> over the total, held as a customer advance
    </span>
  );
}
