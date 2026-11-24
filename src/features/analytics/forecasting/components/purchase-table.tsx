"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PurchaseRow } from "../types";
import { formatQty, formatRate } from "../utils";
import { ItemLink } from "./status";

const dash = <span className="text-muted-foreground">-</span>;

/** `label` names the column in the column menu when the header is shortened. */
const qtyCol = (id: string, title: string, pick: (r: PurchaseRow) => number | null, className?: string, label = title): ColumnDef<PurchaseRow> => ({
  id,
  accessorFn: (r) => pick(r) ?? -1,
  meta: { label, align: "right" },
  header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
  cell: ({ row }) => {
    const v = pick(row.original);
    return v === null ? dash : <span className={cn("tabular whitespace-nowrap", className)}>{formatQty(v, row.original.unit)}</span>;
  },
});

function SuggestionCell({ r }: { r: PurchaseRow }) {
  if (r.suggestedQty <= 0) {
    return <span className="ml-auto block max-w-32 text-right text-xs whitespace-normal text-muted-foreground">{r.basis === "none" && r.perDay === null ? (r.reason ?? "No rate") : "Enough stock"}</span>;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="tabular font-semibold whitespace-nowrap">{formatQty(r.suggestedQty, r.unit)}</span>
      {r.basis === "minimum" ? <span className="max-w-24 text-right text-[11px] whitespace-normal text-muted-foreground">Back to minimum only</span> : null}
    </div>
  );
}

function ReorderCell({ r }: { r: PurchaseRow }) {
  if (!r.reorderDate) return dash;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="whitespace-nowrap">{formatDate(r.reorderDate)}</span>
      {r.lateBy > 0 ? (
        <StatusBadge tone="danger">Late by {r.lateBy} days</StatusBadge>
      ) : r.basis === "minimum" ? (
        <span className="max-w-24 text-[11px] whitespace-normal text-muted-foreground">Already below minimum</span>
      ) : null}
    </div>
  );
}

/** Suggested purchases per material. Recommendations only: nothing is ordered from here. */
export function PurchaseTable({ rows, horizon }: { rows: PurchaseRow[]; horizon: number }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<PurchaseRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Material" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Material" />,
        cell: ({ row }) => <ItemLink id={row.original.id} name={row.original.name} sku={row.original.sku} sub={row.original.categoryName} />,
        enableHiding: false,
      },
      // The answer first (what to buy, by when, at what cost), then the figures behind it, so the
      // suggestion is visible without scrolling sideways.
      {
        id: "suggested",
        accessorKey: "suggestedQty",
        meta: { label: "Suggested purchase", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Suggested" align="right" />,
        cell: ({ row }) => <SuggestionCell r={row.original} />,
      },
      {
        id: "reorder",
        accessorFn: (r) => r.reorderDate ?? "9999",
        meta: { label: "Order by" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Order by" />,
        cell: ({ row }) => <ReorderCell r={row.original} />,
      },
      {
        id: "cost",
        accessorFn: (r) => r.estimatedCost ?? -1,
        meta: { label: "Estimated cost", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estimated cost" align="right" />,
        cell: ({ row }) => {
          const r = row.original;
          if (r.suggestedQty <= 0) return dash;
          if (r.estimatedCost === null) return <span className="ml-auto block max-w-24 text-right text-xs whitespace-normal text-muted-foreground">No price recorded</span>;
          return (
            <div className="flex flex-col items-end gap-0.5">
              <Money value={r.estimatedCost} className="font-medium" />
              <span className="max-w-32 text-right text-[11px] whitespace-normal text-muted-foreground">
                at <Money value={r.price} /> {r.priceBasis === "last_purchase" ? "last price" : "average cost"}
              </span>
            </div>
          );
        },
      },
      qtyCol("available", "Available", (r) => r.available),
      qtyCol("allocated", "Issued to projects", (r) => r.allocated),
      qtyCol("minStock", "Minimum level", (r) => r.minStock),
      {
        id: "perDay",
        accessorFn: (r) => r.perDay ?? -1,
        meta: { label: "Average use", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Average use" align="right" />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{formatRate(row.original.perDay, row.original.unit)}</span>,
      },
      {
        id: "lead",
        accessorFn: (r) => r.leadTimeDays ?? -1,
        meta: { label: "Lead time", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Lead time" align="right" />,
        cell: ({ row }) =>
          row.original.leadTimeDays === null ? <span className="text-xs text-muted-foreground">Not set</span> : <span className="tabular">{row.original.leadTimeDays} days</span>,
      },
      qtyCol("requirement", "Needed", (r) => r.requirement, undefined, `Needed (${horizon} days + lead time)`),
    ],
    [horizon],
  );
  return (
    <DataTable
      id="forecast-purchases"
      columns={columns}
      data={rows}
      searchPlaceholder="Search materials"
      initialHidden={["allocated", "minStock"]}
      pageSize={25}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/inventory/items/${r.id}`)}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{r.sku}</p>
            </div>
            {r.suggestedQty > 0 ? <span className="tabular shrink-0 font-semibold">Buy {formatQty(r.suggestedQty, r.unit)}</span> : null}
          </div>
          <p className="tabular text-sm text-muted-foreground">
            {formatQty(r.available, r.unit)} available · minimum {formatQty(r.minStock)}
          </p>
          {r.suggestedQty > 0 ? (
            <p className="text-xs text-muted-foreground">
              Order by {r.reorderDate ? formatDate(r.reorderDate) : "-"}
              {r.estimatedCost !== null ? (
                <>
                  {" "}
                  · about <Money value={r.estimatedCost} compact />
                </>
              ) : null}
              {r.basis === "minimum" ? " · back to minimum only" : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{r.perDay === null ? r.reason : "Enough stock for the horizon"}</p>
          )}
        </div>
      )}
    />
  );
}
