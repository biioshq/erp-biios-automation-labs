"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight } from "lucide-react";
import { DataTable, DataTableColumnHeader, DateRangeFilter, useTableUrl } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PeriodItemRow } from "../types";

/** The period's dates in the URL (?from&to). Clearing them goes back to this financial year. */
export function PeriodPicker({ from, to }: { from: string; to: string }) {
  const url = useTableUrl();
  return (
    <DateRangeFilter
      from={url.get("from") ?? from}
      to={url.get("to") ?? to}
      label="Period"
      className={cn(url.isPending && "opacity-60")}
      onChange={(r) => url.set({ from: r.from, to: r.to })}
    />
  );
}

const n = (v: number) => formatNumber(v);

/** The period's movements in words, leaving out the kinds that did not happen ("2 bought, 1 issued"). */
function movementSummary(r: { purchased: number; issued: number; returned: number; wasted: number; adjusted: number }): string {
  const parts = [
    r.purchased ? `+${n(r.purchased)} bought` : null,
    r.issued ? `-${n(r.issued)} issued` : null,
    r.returned ? `+${n(r.returned)} returned` : null,
    r.wasted ? `-${n(r.wasted)} wasted` : null,
    r.adjusted ? `${r.adjusted > 0 ? "+" : ""}${n(r.adjusted)} adjusted` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No movement in the period";
}

function qtyCol(id: keyof PeriodItemRow & string, title: string, valueKey?: keyof PeriodItemRow & string): ColumnDef<PeriodItemRow> {
  return {
    id,
    accessorFn: (r) => r[id] as number,
    meta: { label: title, align: "right" },
    header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
    cell: ({ row }) => {
      const value = row.original[id] as number;
      const money = valueKey ? (row.original[valueKey] as number) : 0;
      return (
        <div className="text-right">
          <span className="tabular whitespace-nowrap">{n(value)}</span>
          {money ? <Money value={money} className="block text-[11px] text-muted-foreground" /> : null}
        </div>
      );
    },
  };
}

/** Per item in the period: storage at the start and end, and what came in and went out. */
export function PeriodItemsTable({ rows }: { rows: PeriodItemRow[] }) {
  const columns = useMemo<ColumnDef<PeriodItemRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => `${r.name} ${r.sku}`,
        meta: { label: "Item" },
        header: "Item",
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-40 max-w-60">
            <Link href={`/inventory/items/${row.original.id}`} className="block truncate font-medium hover:underline">
              {row.original.name}
            </Link>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{row.original.sku}</p>
          </div>
        ),
      },
      qtyCol("opening", "Opening"),
      qtyCol("purchased", "Purchased", "purchasedValue"),
      qtyCol("issued", "Issued", "issuedValue"),
      qtyCol("returned", "Returned"),
      qtyCol("wasted", "Wasted", "wastedValue"),
      qtyCol("adjusted", "Adjusted"),
      qtyCol("closing", "Closing"),
    ],
    [],
  );
  return (
    <DataTable
      id="valuation-period-items"
      columns={columns}
      data={rows}
      pageSize={10}
      searchPlaceholder="Search item or SKU…"
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/inventory/items/${r.id}`} className="min-w-0 flex-1 truncate font-medium">
              {r.name}
            </Link>
            <span className="tabular shrink-0 text-sm">
              {n(r.opening)} to {n(r.closing)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{movementSummary(r)}</p>
        </div>
      )}
      emptyState={<EmptyState compact icon={ArrowLeftRight} title="No stock in this period" description="Pick other dates, or record a purchase to start the stock history." />}
    />
  );
}
