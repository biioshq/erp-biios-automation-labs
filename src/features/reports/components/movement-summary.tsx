"use client";

import { ArrowLeftRight } from "lucide-react";
import { DateRangeFilter, useTableUrl } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { MovementTypeBadge } from "@/components/shared/status-badge";
import { formatNumber } from "@/lib/format";
import type { MovementTypeSummary } from "../queries";
import { DownloadButtons } from "./download-buttons";

/** Stock movements by type for a period, with the ledger download for the same period. */
export function MovementSummary({ rows, from, to }: { rows: MovementTypeSummary[]; from: string | null; to: string | null }) {
  const url = useTableUrl();
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="space-y-4" aria-busy={url.isPending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangeFilter from={from} to={to} onChange={(r) => url.set({ from: r.from, to: r.to })} label="Period" />
        <DownloadButtons type="inventory" filters={{ movements: true, from, to }} />
      </div>
      {total === 0 ? (
        <EmptyState compact icon={ArrowLeftRight} title="No stock movements in this period" description="Purchases, assignments, returns and adjustments appear here once recorded. Try a wider period." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Movement</th>
                <th className="px-3 py-2.5 text-right font-medium">Entries</th>
                <th className="px-3 py-2.5 text-right font-medium">Units</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.type} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <MovementTypeBadge type={r.type} />
                  </td>
                  <td className="tabular px-3 py-3 text-right">{formatNumber(r.count)}</td>
                  <td className="tabular px-3 py-3 text-right text-muted-foreground">{formatNumber(r.units)}</td>
                  <td className="px-4 py-3 text-right">{r.value > 0 ? <Money value={r.value} /> : <span className="text-muted-foreground/50">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
