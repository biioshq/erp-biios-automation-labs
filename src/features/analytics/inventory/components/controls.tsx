"use client";

import { useState } from "react";
import { DateRangeFilter, useTableUrl } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Filters of the analytics pages. Each writes its value to the URL so the server renders the
 * figures for it, and a copied link shows the same view.
 */

/** The page's date range (?from&to); `defaultText` says what applies when none is set. */
export function RangeControl({ from, to, isDefault, defaultText }: { from: string; to: string; isDefault: boolean; defaultText: string }) {
  const url = useTableUrl();
  // The calendar picks the start first; the range applies once both days are chosen.
  const [draft, setDraft] = useState<{ from: string | null; to: string | null } | null>(null);
  function pick(r: { from: string | null; to: string | null }) {
    if (r.from && !r.to) return setDraft(r);
    setDraft(null);
    url.set({ from: r.from, to: r.to });
  }
  const shown = draft ?? { from, to };
  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", url.isPending && "opacity-60")}>
      <DateRangeFilter from={shown.from} to={shown.to} label="Date range" onChange={pick} />
      {isDefault ? <span className="text-xs text-muted-foreground">{defaultText}</span> : null}
    </div>
  );
}

/** A single choice kept in ?<name>=; the default value is left out of the URL. */
export function ParamSelect({
  name,
  value,
  fallback,
  options,
  label,
  className,
}: {
  name: string;
  value: string;
  fallback: string;
  options: readonly { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  const url = useTableUrl();
  return (
    <Select value={value} onValueChange={(v) => url.set({ [name]: v === fallback ? null : v })}>
      <SelectTrigger className={cn("h-8 w-full max-md:h-10 sm:w-auto sm:min-w-44", url.isPending && "opacity-60", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A segmented choice kept in ?<name>=. */
export function ParamToggle({
  name,
  value,
  fallback,
  options,
  label,
}: {
  name: string;
  value: string;
  fallback: string;
  options: readonly { value: string; label: string }[];
  label: string;
}) {
  const url = useTableUrl();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      onValueChange={(v) => v && url.set({ [name]: v === fallback ? null : v })}
      aria-label={label}
      className={cn("transition-opacity", url.isPending && "opacity-60")}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-3 text-[13px] max-md:h-10 data-[state=on]:bg-brand/10 data-[state=on]:text-brand-ink">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Ageing bucket edges in days (?b=30,60,90), checked on the server; a bad list falls back to the default. */
export function AgeEdgesInput({ edges, isDefault }: { edges: number[]; isDefault: boolean }) {
  const url = useTableUrl();
  const [text, setText] = useState(edges.join(", "));
  function apply(e: React.FormEvent) {
    e.preventDefault();
    const clean = text
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(",");
    url.set({ b: clean || null });
  }
  return (
    <form onSubmit={apply} className={cn("flex flex-wrap items-center gap-2 transition-opacity", url.isPending && "opacity-60")}>
      <label htmlFor="age-edges" className="text-xs text-muted-foreground">
        Bucket edges (days)
      </label>
      <Input id="age-edges" value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" className="w-36" placeholder="30, 60, 90" />
      <Button type="submit" size="sm" variant="outline">
        Apply
      </Button>
      {!isDefault ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setText("30, 60, 90");
            url.set({ b: null });
          }}
        >
          Reset
        </Button>
      ) : null}
    </form>
  );
}
