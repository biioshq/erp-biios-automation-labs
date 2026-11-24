"use client";

import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ColumnRole, GridRow } from "../types";
import { COLUMN_ROLES, mappingProblems } from "../parse/columns";

const NONE = "__none";
/** Rows offered as the header row: statements start with a few lines about the account. */
const HEADER_CHOICES = 60;

const rowPreview = (r: GridRow) =>
  r.cells
    .filter((c) => c.trim())
    .join(" | ")
    .slice(0, 90) || "(empty row)";

/**
 * The row that holds the column names and what each column is. The reader picks both; the admin
 * corrects them here when a bank names its columns in a way the reader did not know.
 */
export function MappingPanel({
  grid,
  headerIndex,
  mapping,
  onHeaderChange,
  onMappingChange,
  disabled,
}: {
  grid: GridRow[];
  headerIndex: number;
  mapping: (ColumnRole | null)[];
  onHeaderChange: (index: number) => void;
  onMappingChange: (mapping: (ColumnRole | null)[]) => void;
  disabled?: boolean;
}) {
  const header = useMemo(() => (headerIndex >= 0 ? (grid[headerIndex]?.cells ?? []) : []), [grid, headerIndex]);
  const problems = headerIndex >= 0 ? mappingProblems(mapping) : ["Pick the row that holds the column names."];
  // A value from the first rows under the header, to show what each column holds.
  const samples = useMemo(
    () => header.map((_, i) => grid.slice(headerIndex + 1, headerIndex + 30).find((r) => r.cells[i]?.trim())?.cells[i] ?? ""),
    [grid, header, headerIndex],
  );

  function setRole(i: number, role: ColumnRole | null) {
    const next = header.map((_, j) => mapping[j] ?? null);
    // A role belongs to one column: picking it here takes it off any other column.
    if (role) for (let j = 0; j < next.length; j++) if (next[j] === role) next[j] = null;
    next[i] = role;
    onMappingChange(next);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5 sm:max-w-xl">
        <Label htmlFor="header-row">Row with the column names</Label>
        <Select value={headerIndex >= 0 ? String(headerIndex) : undefined} onValueChange={(v) => onHeaderChange(Number(v))} disabled={disabled}>
          <SelectTrigger id="header-row" className="w-full">
            <SelectValue placeholder="Pick the row" />
          </SelectTrigger>
          <SelectContent>
            {grid.slice(0, HEADER_CHOICES).map((r, i) => (
              <SelectItem key={`${r.line}-${i}`} value={String(i)}>
                <span className="truncate">
                  Row {r.line}: {rowPreview(r)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {header.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {header.map((name, i) => (
            <div key={i} className={cn("min-w-0 space-y-1.5 rounded-lg border p-2.5", mapping[i] && "border-brand/30 bg-brand/5")}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={name}>
                  {name || `Column ${i + 1}`}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={samples[i]}>
                  {samples[i] ? `e.g. ${samples[i]}` : "Empty in the first rows"}
                </p>
              </div>
              <Select value={mapping[i] ?? NONE} onValueChange={(v) => setRole(i, v === NONE ? null : (v as ColumnRole))} disabled={disabled}>
                <SelectTrigger size="sm" className="w-full" aria-label={`What column ${name || i + 1} holds`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not used</SelectItem>
                  {COLUMN_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : null}

      {problems.length ? (
        <ul className="space-y-1 text-sm text-danger" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
