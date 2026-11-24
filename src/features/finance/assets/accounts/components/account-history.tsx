"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownLeft, ArrowUpRight, History } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, DataTableColumnHeader, DateRangeFilter, useTableUrl } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { AccountHistory, AccountRow, HistoryRow } from "../types";

function Figure({ label, value, tone }: { label: string; value: number; tone?: "positive" | "negative" | "auto" }) {
  return (
    <div className="min-w-0 rounded-lg border bg-surface/40 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Money value={value} tone={tone} className="text-base font-semibold" />
    </div>
  );
}

function Label({ row }: { row: HistoryRow }) {
  const inflow = row.amount >= 0;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg border bg-surface", inflow ? "text-success" : "text-danger")}>
        {inflow ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
      </span>
      {row.href ? (
        <Link href={row.href} className="truncate font-medium hover:underline">
          {row.label}
        </Link>
      ) : (
        <span className="truncate font-medium">{row.label}</span>
      )}
    </div>
  );
}

/** One account's transactions with the running balance, for an account and dates picked in the URL. */
export function AccountHistoryPanel({ accounts, history }: { accounts: AccountRow[]; history: AccountHistory | null }) {
  const url = useTableUrl();
  const from = url.get("from");
  const to = url.get("to");

  const columns = useMemo<ColumnDef<HistoryRow>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(fromDateInput(row.original.date))}</span>,
      },
      {
        id: "label",
        accessorKey: "label",
        meta: { label: "Record" },
        header: "Record",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-56 max-w-md">
            <Label row={row.original} />
          </div>
        ),
      },
      {
        id: "in",
        meta: { label: "Money in", align: "right" },
        header: "Money in",
        enableSorting: false,
        cell: ({ row }) => (row.original.amount >= 0 ? <Money value={row.original.amount} tone="positive" /> : null),
      },
      {
        id: "out",
        meta: { label: "Money out", align: "right" },
        header: "Money out",
        enableSorting: false,
        cell: ({ row }) => (row.original.amount < 0 ? <Money value={-row.original.amount} tone="negative" /> : null),
      },
      {
        id: "balance",
        accessorKey: "balance",
        meta: { label: "Balance", align: "right" },
        header: "Balance",
        enableSorting: false,
        cell: ({ row }) => <Money value={row.original.balance} tone="auto" className="font-medium" />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={history?.code ?? ""} onValueChange={(v) => url.set({ account: v })}>
          <SelectTrigger className="h-8 w-full min-w-0 sm:w-72 max-md:h-10" aria-label="Account">
            <SelectValue placeholder="Pick an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.code} value={a.code}>
                {a.name}
                {a.archived ? " (archived)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeFilter from={from} to={to} onChange={(r) => url.set({ from: r.from, to: r.to })} />
      </div>

      {history ? (
        <>
          <div className={cn("grid grid-cols-2 gap-2 lg:grid-cols-4", url.isPending && "opacity-60")}>
            <Figure label={history.from ? `Balance before ${formatDate(fromDateInput(history.from))}` : "Starting balance"} value={history.opening} tone="auto" />
            <Figure label="Money in" value={history.moneyIn} tone="positive" />
            <Figure label="Money out" value={history.moneyOut} tone="negative" />
            <Figure label={`Balance on ${formatDate(fromDateInput(history.to))}`} value={history.closing} tone="auto" />
          </div>
          <DataTable
            id="account-history"
            columns={columns}
            data={history.rows}
            pageSize={20}
            searchPlaceholder="Search records…"
            getRowId={(r) => r.key}
            className={cn(url.isPending && "opacity-60")}
            renderMobileRow={(r) => (
              <div className="min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <Label row={r} />
                  </div>
                  <Money value={r.amount} tone={r.amount >= 0 ? "positive" : "negative"} className="shrink-0 font-semibold" />
                </div>
                <p className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(fromDateInput(r.date))}</span>
                  <span>
                    Balance <Money value={r.balance} tone="auto" />
                  </span>
                </p>
              </div>
            )}
            emptyState={
              <EmptyState
                compact
                icon={History}
                title="Nothing recorded in these dates"
                description="Expenses paid, income received and transfers that use this account show here."
              />
            }
          />
        </>
      ) : (
        <EmptyState compact icon={History} title="Pick an account" description="Its transactions show here with the running balance." />
      )}
    </div>
  );
}
