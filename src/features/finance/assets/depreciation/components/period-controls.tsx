"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DateRangeFilter } from "@/components/data-table/date-range-filter";
import { cn } from "@/lib/utils";
import { fyLabel, type AssetKindFilter, type DepreciationPeriod } from "../period";

const KINDS: { value: AssetKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tangible", label: "Fixed" },
  { value: "intangible", label: "Intangible" },
];

/**
 * Period and asset kind of the depreciation summary: a financial year, or custom dates. Everything
 * is written to the URL (?fy, ?from, ?to, ?kind) and the server renders the figures.
 */
export function PeriodControls({ period, years, kind, showKind = true }: { period: DepreciationPeriod; years: number[]; kind: AssetKindFilter; showKind?: boolean }) {
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

  function pickRange(range: { from: string | null; to: string | null }) {
    if (!range.from && !range.to) {
      setDraft(null);
      go({ from: null, to: null });
      return;
    }
    if (range.from && range.to) {
      setDraft(null);
      go({ fy: null, from: range.from, to: range.to });
      return;
    }
    setDraft(range);
  }

  const shown = draft ?? (period.mode === "custom" ? { from: period.from, to: period.to } : { from: null, to: null });
  const fyValue = period.mode === "fy" && period.fyStart !== null ? String(period.fyStart) : "";

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <Select
        value={fyValue}
        onValueChange={(v) => {
          setDraft(null);
          go({ fy: v === String(years[0]) ? null : v, from: null, to: null });
        }}
      >
        <SelectTrigger size="sm" className={cn("w-36 max-md:h-10", period.mode === "fy" && "border-brand/40 bg-brand/10 text-brand-ink")} aria-label="Financial year">
          <SelectValue placeholder="Financial year" />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {fyLabel(y)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DateRangeFilter
        from={shown.from}
        to={shown.to}
        onChange={pickRange}
        label="Custom dates"
        className={cn(period.mode === "custom" && "border-brand/40 bg-brand/10 text-brand-ink")}
      />
      {showKind ? (
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={kind}
        onValueChange={(v) => v && go({ kind: v === "all" ? null : v })}
        aria-label="Asset kind"
        className="sm:ml-auto"
      >
        {KINDS.map((k) => (
          <ToggleGroupItem key={k.value} value={k.value} className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
            {k.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      ) : null}
    </div>
  );
}
