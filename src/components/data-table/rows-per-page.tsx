"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_PAGE_SIZE, PAGE_SIZES } from "@/lib/list-params";
import { cn } from "@/lib/utils";

const CUSTOM = "custom";
const ALL = "all";

/**
 * "Rows" box under a table: the usual sizes, the current size even when it is not one of them (so
 * the box never looks empty), "All" where the caller allows it, and "Custom" to type any number
 * from 1 to MAX_PAGE_SIZE. `value` null means all rows.
 */
export function RowsPerPage({
  value,
  onChange,
  allowAll = false,
  label = "Rows",
  className,
}: {
  value: number | null;
  onChange: (rows: number | null) => void;
  allowAll?: boolean;
  label?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const sizes = [...new Set<number>([...PAGE_SIZES, ...(value !== null ? [value] : [])])].sort((a, b) => a - b);

  const apply = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isInteger(n) && n >= 1) onChange(Math.min(n, MAX_PAGE_SIZE));
    setEditing(false);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {editing ? (
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_PAGE_SIZE}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label={`Rows per page, 1 to ${MAX_PAGE_SIZE}`}
          placeholder={`1 to ${MAX_PAGE_SIZE}`}
          className="tabular h-8 w-24 text-sm"
        />
      ) : (
        <Select
          value={value === null ? ALL : String(value)}
          onValueChange={(v) => {
            if (v === CUSTOM) {
              setDraft(value === null ? "" : String(value));
              setEditing(true);
            } else onChange(v === ALL ? null : Number(v));
          }}
        >
          <SelectTrigger size="sm" className="tabular h-8 w-[84px]" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top">
            {sizes.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}
              </SelectItem>
            ))}
            {allowAll ? <SelectItem value={ALL}>All</SelectItem> : null}
            <SelectSeparator />
            <SelectItem value={CUSTOM}>Custom…</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
