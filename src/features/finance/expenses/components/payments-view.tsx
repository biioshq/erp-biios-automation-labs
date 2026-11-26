"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { CalendarClock, Eye, History, Landmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { PAYMENT_METHODS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankAccountOption } from "@/server/lookups";
import { deleteExpensePayment } from "../payment-actions";
import type { PaymentDefaults, PaymentHistoryRow, PaymentTabTotals } from "../payment-queries";
import { DEFAULT_PAYMENT_TAB, PAYMENT_TABS, type PaymentTab } from "../payment-tabs";
import { takesPayments } from "../sources";
import type { ExpenseRow } from "../types";
import { BankMarker, PaymentStateCell } from "./expense-badges";
import { BulkMarkPaidButton, MarkPaidButton } from "./mark-paid";
import { RecordPaymentButton } from "./record-payment-dialog";
import { BankLineLink } from "@/features/finance/bank-statements/components/bank-line-link";
import { bankLineHref } from "@/features/finance/bank-statements/line-href";

const EMPTY: Record<PaymentTab, { title: string; description: string }> = {
  outstanding: {
    title: "Nothing outstanding",
    description: "Every expense saved as Not paid yet or Partly paid shows here until it is paid. Tick Mark as paid when you pay one.",
  },
  unpaid: { title: "No unpaid bills", description: "Expenses saved as Not paid yet show here until a payment is recorded or they fall due." },
  partial: { title: "No part-paid bills", description: "Expenses with part of the amount paid show here until the rest is paid or falls due." },
  upcoming: { title: "Nothing due in the next 30 days", description: "Unpaid and part-paid bills due today or within 30 days show here." },
  overdue: { title: "Nothing overdue", description: "Bills past their due date with something still owed show here." },
  paid: { title: "No paid expenses", description: "Expenses with nothing left to pay show here." },
  history: {
    title: "No payments recorded yet",
    description: "Payments recorded against expenses (part payments, payments of bills on credit) are listed here with who recorded them. Expenses paid in full when they were saved are under Paid.",
  },
};

/** The tab row: each tab with its count and money, as links so the server renders the tab. */
export function PaymentTabs({ tab, totals }: { tab: PaymentTab; totals: PaymentTabTotals }) {
  const searchParams = useSearchParams();
  const hrefFor = (value: PaymentTab) => {
    const params = new URLSearchParams(searchParams.toString());
    ["page", "sort", "tab"].forEach((k) => params.delete(k));
    if (value !== DEFAULT_PAYMENT_TAB) params.set("tab", value);
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };
  return (
    <nav aria-label="Payment status" className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex w-max min-w-full gap-2">
        {PAYMENT_TABS.map((t) => {
          const active = t.value === tab;
          const total = totals[t.value];
          return (
            <li key={t.value}>
              <Link
                href={hrefFor(t.value)}
                scroll={false}
                aria-current={active ? "page" : undefined}
                title={t.hint}
                className={cn(
                  "flex min-w-36 flex-col rounded-lg border px-3 py-2 text-left transition-colors hover:border-foreground/20",
                  active ? "border-brand/50 bg-brand/8 text-foreground" : "bg-card text-muted-foreground",
                  t.value === "overdue" && total.count > 0 && !active && "border-danger/30",
                )}
              >
                <span className="text-[12.5px] font-medium">
                  {t.label} <span className="tabular text-muted-foreground">· {formatNumber(total.count)}</span>
                </span>
                <Money value={total.total} className={cn("text-sm font-semibold text-foreground", t.value === "overdue" && total.total > 0 && "text-danger")} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ViewLink({ id }: { id: string }) {
  return (
    <Button asChild variant="ghost" size="icon-sm" aria-label="Open expense">
      <Link href={`/finance/expenses?view=${id}`}>
        <Eye />
      </Link>
    </Button>
  );
}

/** "No due date" when none was saved: the status still counts the expense date as due. */
function DueDateCell({ row }: { row: ExpenseRow }) {
  if (row.payment.outstanding <= 0) return <span className="text-muted-foreground/60">-</span>;
  if (!row.dueDate) {
    return (
      <div className="whitespace-nowrap text-xs text-muted-foreground">
        <p>No due date</p>
        {/* The status counts from the expense date when no due date was saved. */}
        {row.payment.status === "overdue" ? <p className="text-[11px]">Counted from {formatDate(row.date)}</p> : null}
      </div>
    );
  }
  return (
    <span className={cn("whitespace-nowrap", row.payment.status === "overdue" ? "font-medium text-danger" : "text-muted-foreground")}>
      {formatDate(row.dueDate)}
    </span>
  );
}

/** Unpaid, part-paid, upcoming, overdue or paid expenses: what each one costs, what is paid and what is owed. */
export function PaymentExpensesTable({
  tab,
  rows,
  total,
  page,
  pageSize,
  accounts,
  defaults,
}: {
  tab: Exclude<PaymentTab, "history">;
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  accounts: BankAccountOption[];
  /** What Mark as paid starts with (method and account). */
  defaults: PaymentDefaults;
}) {
  const canPay = useCan("finance.payments:create");
  // Paid rows leave the list at once; the page refresh then brings the next ones in.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const hide = useCallback((ids: string[]) => {
    setHidden((h) => new Set([...h, ...ids]));
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
  }, []);
  const unhide = useCallback((ids: string[]) => setHidden((h) => new Set([...h].filter((id) => !ids.includes(id)))), []);
  const shown = useMemo(() => rows.filter((r) => !hidden.has(r.id)), [rows, hidden]);
  const payable = (r: ExpenseRow) => takesPayments(r.source) && r.payment.outstanding > 0;
  const selectable = canPay && tab !== "paid";
  const payableShown = useMemo(() => shown.filter(payable), [shown]);
  const selectedRows = useMemo(() => payableShown.filter((r) => selected.has(r.id)), [payableShown, selected]);
  const allSelected = payableShown.length > 0 && selectedRows.length === payableShown.length;
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const actions = (r: ExpenseRow) => (
    <>
      {payable(r) ? (
        <>
          <MarkPaidButton
            expense={{ id: r.id, number: r.number, vendor: r.vendor, outstanding: r.payment.outstanding, paymentMethod: r.paymentMethod }}
            accounts={accounts}
            defaults={defaults}
            onPaid={(id) => hide([id])}
            onUndone={unhide}
          />
          <RecordPaymentButton
            expense={{ id: r.id, number: r.number, vendor: r.vendor, outstanding: r.payment.outstanding }}
            accounts={accounts}
            size="icon-sm"
            variant="ghost"
            label="Record a part payment"
          />
        </>
      ) : null}
      <ViewLink id={r.id} />
    </>
  );

  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      ...(selectable
        ? [
            {
              id: "select",
              header: () => (
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allSelected ? true : selectedRows.length ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(payableShown.map((r) => r.id)) : new Set())}
                  disabled={!payableShown.length}
                />
              ),
              enableHiding: false,
              enableSorting: false,
              meta: { className: "w-8" },
              cell: ({ row }) =>
                payable(row.original) ? (
                  <Checkbox
                    aria-label={`Select ${row.original.number}`}
                    checked={selected.has(row.original.id)}
                    onCheckedChange={(v) => toggle(row.original.id, v === true)}
                  />
                ) : null,
            } satisfies ColumnDef<ExpenseRow>,
          ]
        : []),
      {
        id: "vendor",
        meta: { label: "Vendor" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-40">
            <p className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{row.original.vendor}</span>
              {row.original.fromBank ? <BankMarker /> : null}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {row.original.number}
              <span className="font-sans"> · {row.original.categoryLabel}</span>
            </p>
          </div>
        ),
      },
      {
        id: "description",
        meta: { label: "Description" },
        header: "Description",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.description ? (
            <span className="block max-w-56 truncate text-muted-foreground" title={row.original.description}>
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground/60">-</span>
          ),
      },
      {
        id: "amount",
        meta: { label: "Bill amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        cell: ({ row }) => <Money value={row.original.amount} className="font-medium" />,
      },
      {
        id: "paid",
        meta: { label: "Paid", align: "right" },
        header: () => <div className="text-right text-xs">Paid</div>,
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.payment.paid} className="text-muted-foreground" />,
      },
      {
        id: "outstanding",
        meta: { label: "Still owed", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Owed" align="right" />,
        enableHiding: false,
        cell: ({ row }) => <Money value={row.original.payment.outstanding} className={row.original.payment.outstanding > 0 ? "font-semibold" : "text-muted-foreground"} />,
      },
      {
        id: "date",
        meta: { label: "Expense date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(row.original.date)}</span>,
      },
      {
        id: "due",
        meta: { label: "Due date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) => <DueDateCell row={row.original} />,
      },
      {
        id: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <PaymentStateCell payment={row.original.payment} />,
      },
      {
        id: "project",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.project ? (
            <span className="flex min-w-28 items-center gap-1.5 truncate text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} />
              {row.original.project.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Overhead</span>
          ),
      },
      {
        id: "actions",
        // Stays in view on narrow screens: the tick is the main action of these lists.
        meta: { align: "right", className: "sticky right-0 z-10 bg-card shadow-[-6px_0_6px_-6px_rgb(0_0_0_/_0.12)]", headerClassName: "sticky right-0 z-10 bg-card" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => <div className="flex items-center justify-end gap-1">{actions(row.original)}</div>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, defaults, selectable, selected, allSelected, selectedRows.length, payableShown],
  );

  return (
    <DataTable
      id={`payments-${tab}`}
      mode="server"
      columns={columns}
      data={shown}
      total={total}
      page={page}
      pageSize={pageSize}
      dateRange={{ label: "Expense date" }}
      searchPlaceholder="Search vendor, number, invoice…"
      getRowId={(r) => r.id}
      initialHidden={tab === "paid" ? ["due", "paid", "description"] : ["paid"]}
      toolbarActions={
        selectable && selectedRows.length ? (
          <BulkMarkPaidButton
            selected={selectedRows.map((r) => ({ id: r.id, number: r.number, outstanding: r.payment.outstanding }))}
            accounts={accounts}
            defaults={defaults}
            onPaid={hide}
            onUndone={unhide}
          />
        ) : undefined
      }
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            {selectable && payable(r) ? (
              <span className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                <Checkbox aria-label={`Select ${r.number}`} checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{r.vendor}</span>
                {r.fromBank ? <BankMarker /> : null}
              </p>
              {r.description ? <p className="truncate text-xs text-muted-foreground">{r.description}</p> : null}
            </div>
            <Money value={tab === "paid" ? r.amount : r.payment.outstanding} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.number}</span> · {formatDate(r.date)}
            {r.payment.outstanding > 0 ? (r.dueDate ? ` · due ${formatDate(r.dueDate)}` : " · no due date") : ""}
            {r.project ? ` · ${r.project.name}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <PaymentStateCell payment={r.payment} compact />
            {tab !== "paid" && r.payment.paid > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                <Money value={r.payment.paid} /> paid of <Money value={r.amount} />
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {actions(r)}
            </span>
          </div>
        </div>
      )}
      emptyState={<EmptyState icon={CalendarClock} title={EMPTY[tab].title} description={EMPTY[tab].description} />}
    />
  );
}

function DeletePaymentButton({ row, onConfirm }: { row: PaymentHistoryRow; onConfirm: (row: PaymentHistoryRow) => Promise<boolean> }) {
  return (
    <ConfirmDialog
      title="Delete this payment?"
      description={`${formatDate(row.date)} on ${row.number}. The amount goes back to what is owed on the expense.`}
      onConfirm={() => onConfirm(row)}
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label="Delete payment" className="text-muted-foreground hover:text-danger">
          <Trash2 />
        </Button>
      }
    />
  );
}

/** Every payment recorded against an expense, newest first. Admins can delete one. */
export function PaymentHistoryTable({ rows, total, page, pageSize }: { rows: PaymentHistoryRow[]; total: number; page: number; pageSize: number }) {
  const canDelete = useCan("finance.payments:delete");
  const canOpenLines = useCan("finance.bank_statements:view");

  async function remove(row: PaymentHistoryRow) {
    const result = await deleteExpensePayment({ id: row.expenseId, paymentId: row.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`Payment on ${row.number} deleted`);
    emitDataChanged();
    return true;
  }

  const columns = useMemo<ColumnDef<PaymentHistoryRow>[]>(
    () => [
      {
        id: "date",
        meta: { label: "Paid on" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Paid on" />,
        enableHiding: false,
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span>,
      },
      {
        id: "expense",
        meta: { label: "Expense" },
        header: "Expense",
        enableSorting: false,
        cell: ({ row }) => (
          <Link href={`/finance/expenses?view=${row.original.expenseId}`} className="block min-w-40 hover:underline">
            <span className="block truncate font-medium">{row.original.vendor}</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {row.original.number}
              <span className="font-sans"> · {row.original.categoryLabel}</span>
            </span>
          </Link>
        ),
      },
      {
        id: "amount",
        meta: { label: "Amount", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" align="right" />,
        enableHiding: false,
        cell: ({ row }) => <Money value={row.original.amount} exact className="font-semibold" />,
      },
      {
        id: "method",
        meta: { label: "Method" },
        header: "Method",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{labelOf(PAYMENT_METHODS, row.original.paymentMethod)}</span>,
      },
      {
        id: "account",
        meta: { label: "Paid from" },
        header: "Paid from",
        enableSorting: false,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.account ?? "Default for the method"}</span>,
      },
      {
        id: "reference",
        meta: { label: "Reference" },
        header: "Reference",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block max-w-48 truncate text-muted-foreground" title={row.original.note ?? undefined}>
            {row.original.reference ?? row.original.note ?? "-"}
          </span>
        ),
      },
      {
        id: "recordedBy",
        meta: { label: "Recorded by" },
        header: "Recorded by",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-xs text-muted-foreground">
            <p>{row.original.recordedBy ?? "Unknown"}</p>
            {row.original.recordedAt ? <p>{formatDateTime(row.original.recordedAt)}</p> : null}
          </div>
        ),
      },
      {
        id: "actions",
        // Stays in view on narrow screens: the tick is the main action of these lists.
        meta: { align: "right", className: "sticky right-0 z-10 bg-card shadow-[-6px_0_6px_-6px_rgb(0_0_0_/_0.12)]", headerClassName: "sticky right-0 z-10 bg-card" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.fromBankStatement ? (
            canOpenLines && row.original.bankTransactionId ? (
              <Link
                href={bankLineHref(row.original.bankTransactionId)}
                title="Matched to a bank statement line. Open the line to unmatch it."
                className="inline-flex text-muted-foreground hover:text-brand-ink"
              >
                <Landmark className="size-4" aria-label="Open the bank statement line" />
              </Link>
            ) : (
              <span title="Matched to a bank statement line" className="inline-flex text-muted-foreground">
                <Landmark className="size-4" aria-label="Matched to a bank statement line" />
              </span>
            )
          ) : canDelete ? (
            <DeletePaymentButton row={row.original} onConfirm={remove} />
          ) : null,
      },
    ],
    [canDelete, canOpenLines],
  );

  return (
    <DataTable
      id="payments-history"
      mode="server"
      columns={columns}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      dateRange={{ label: "Paid on" }}
      searchPlaceholder="Search vendor, number…"
      getRowId={(r) => r.id}
      initialHidden={["reference"]}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/finance/expenses?view=${r.expenseId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
              {r.vendor}
            </Link>
            <Money value={r.amount} exact className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {formatDate(r.date)} · {labelOf(PAYMENT_METHODS, r.paymentMethod)}
            {r.account ? ` · ${r.account}` : ""}
          </p>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              <span className="font-mono">{r.number}</span>
              {r.reference ? ` · ${r.reference}` : ""} · by {r.recordedBy ?? "unknown"}
            </p>
            {canDelete && !r.fromBankStatement ? <DeletePaymentButton row={r} onConfirm={remove} /> : null}
            {r.fromBankStatement ? <BankLineLink id={r.bankTransactionId} label="Statement line" className="shrink-0" /> : null}
          </div>
        </div>
      )}
      emptyState={<EmptyState icon={History} title={EMPTY.history.title} description={EMPTY.history.description} />}
    />
  );
}
