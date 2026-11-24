"use client";

import { useTableUrl } from "@/components/data-table";
import { DateRangeFilter } from "@/components/data-table";
import { cn } from "@/lib/utils";

/** The summary's date range, kept in the URL (?from&to) so the server renders the figures for it. */
export function SummaryRange({ from, to, isDefault }: { from: string; to: string; isDefault: boolean }) {
  const url = useTableUrl();
  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", url.isPending && "opacity-60")}>
      <DateRangeFilter from={from} to={to} label="Date range" onChange={(r) => url.set({ from: r.from, to: r.to })} />
      {isDefault ? <span className="text-xs text-muted-foreground">This financial year to date</span> : null}
    </div>
  );
}
