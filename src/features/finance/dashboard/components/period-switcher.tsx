"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { cn } from "@/lib/utils";
import { DASHBOARD_PERIODS, DEFAULT_PERIOD, type DashboardPeriod } from "../periods";

/**
 * Segmented control that writes ?period= and lets the server re-render the dashboard, plus a
 * custom from / to range (?period=custom&from=&to=). Every choice stays in the URL.
 */
export function PeriodSwitcher({ value, custom }: { value: DashboardPeriod; custom?: { from: string; to: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The calendar picks the start first; the range applies once both days are chosen.
  const [draft, setDraft] = useState<{ from: string | null; to: string | null } | null>(null);

  function go(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, v] of Object.entries(changes)) {
      if (v === null) params.delete(key);
      else params.set(key, v);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function change(next: string) {
    if (!next || next === value) return;
    setDraft(null);
    go({ period: next === DEFAULT_PERIOD ? null : next, from: null, to: null });
  }

  function pickRange(range: { from: string | null; to: string | null }) {
    if (!range.from && !range.to) {
      setDraft(null);
      go({ period: null, from: null, to: null });
      return;
    }
    if (range.from && range.to) {
      setDraft(null);
      go({ period: "custom", from: range.from, to: range.to });
      return;
    }
    setDraft(range);
  }

  const shown = draft ?? (custom ? { from: custom.from, to: custom.to } : { from: null, to: null });

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={value === "custom" ? "" : value} onValueChange={change} aria-label="Reporting period">
        {DASHBOARD_PERIODS.map((p) => (
          <ToggleGroupItem key={p.value} value={p.value} className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <DateRangeFilter
        from={shown.from}
        to={shown.to}
        onChange={pickRange}
        label="Custom range"
        className={cn(value === "custom" && "border-brand/40 bg-brand/10 text-brand-ink")}
      />
    </div>
  );
}
