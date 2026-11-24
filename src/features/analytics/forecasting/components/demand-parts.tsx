"use client";

import { StatusBadge } from "@/components/shared/status-badge";
import { Money } from "@/components/shared/money";
import { formatDate } from "@/lib/format";
import type { DemandRow, ProjectUseRow, ShortageRow } from "../types";
import { formatQty } from "../utils";
import { ItemLink, ProjectLink } from "./status";

const LEVEL: Record<ShortageRow["level"], { label: string; tone: "danger" | "warning" | "info" }> = {
  out: { label: "Out of stock", tone: "danger" },
  below_min: { label: "Below minimum", tone: "warning" },
  runs_out: { label: "Runs out soon", tone: "info" },
};

/** Materials at risk of shortage, most urgent first, each with why it is listed. */
export function ShortageList({ rows }: { rows: ShortageRow[] }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <ItemLink id={r.id} name={r.name} sku={r.sku} />
            <p className="text-xs text-muted-foreground">
              {r.reasons.join(". ")}.
              {r.limitedHistory ? " This material has too little history for a forecast, so treat this date as rough." : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:flex-col sm:items-end">
            <StatusBadge tone={LEVEL[r.level].tone}>{LEVEL[r.level].label}</StatusBadge>
            <span className="tabular text-muted-foreground">
              {formatQty(r.available, r.unit)} left
              {r.minStock > 0 ? ` · minimum ${formatQty(r.minStock)}` : ""}
            </span>
            {r.orderBy ? <span className="text-muted-foreground">Order by {formatDate(r.orderBy)}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Materials that may be overstocked, with the reason. */
export function OverstockList({ rows }: { rows: DemandRow[] }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <ItemLink id={r.id} name={r.name} sku={r.sku} sub={r.categoryName} />
            <p className="text-xs text-muted-foreground">{r.overstock}</p>
          </div>
          <div className="tabular shrink-0 text-right text-xs text-muted-foreground">
            {formatQty(r.available, r.unit)} available · <Money value={r.value} compact /> at cost
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What each project used in the window, by value. */
export function ProjectUseList({ rows }: { rows: ProjectUseRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.projectId} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <ProjectLink id={r.projectId} name={r.name} code={r.code} color={r.color} href={`/finance/projects/${r.projectId}?tab=inventory`} />
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Money value={r.value} className="text-sm font-medium" />
              <span className="text-xs text-muted-foreground">
                {r.materials} {r.materials === 1 ? "material" : "materials"}
              </span>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
