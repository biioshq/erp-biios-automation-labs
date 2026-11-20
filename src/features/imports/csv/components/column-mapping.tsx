"use client";

import { TriangleAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CSV_FIELDS, DETAIL_COLUMN, type CsvImportKind } from "../fields";

const SKIP = "__skip";

/**
 * One card per column of the file: its header, a sample value and the field it goes into. Picking a
 * field another column already uses moves it here, so a field never gets two columns.
 */
export function ColumnMapping({
  kind,
  headers,
  samples,
  mapping,
  onChange,
  disabled,
}: {
  kind: CsvImportKind;
  headers: string[];
  samples: string[];
  mapping: (string | null)[];
  onChange: (mapping: (string | null)[]) => void;
  disabled?: boolean;
}) {
  const fields = CSV_FIELDS[kind];
  const missing = fields.filter((f) => f.required && !mapping.includes(f.key));

  function set(index: number, key: string | null) {
    // A field goes to one column only; any number of columns can be details.
    const next = mapping.map((m, i) => (i === index ? key : key && key !== DETAIL_COLUMN && m === key ? (kind === "items" ? DETAIL_COLUMN : null) : m));
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {missing.length ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            No column is set for {missing.map((f) => f.label).join(", ")}. Pick the column that holds {missing.length === 1 ? "it" : "them"}, or add{" "}
            {missing.length === 1 ? "it" : "them"} to the file.
          </span>
        </p>
      ) : null}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {headers.map((header, i) => {
          const key = mapping[i] ?? null;
          const field = fields.find((f) => f.key === key);
          return (
            <li key={i} className={cn("min-w-0 rounded-lg border px-3 py-2.5", key && key !== DETAIL_COLUMN ? "bg-card" : key ? "bg-card/60" : "bg-muted/40")}>
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium" title={header}>
                  {header || `Column ${i + 1}`}
                </p>
                <span className="shrink-0 text-[11px] text-muted-foreground">Column {i + 1}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={samples[i]}>
                {samples[i] ? `e.g. ${samples[i]}` : "Empty in the first rows"}
              </p>
              <Select value={key ?? SKIP} onValueChange={(v) => set(i, v === SKIP ? null : v)} disabled={disabled}>
                <SelectTrigger size="sm" className="mt-2 w-full max-md:h-10" aria-label={`Field for column ${header || i + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SKIP}>Do not import</SelectItem>
                  {kind === "items" ? <SelectItem value={DETAIL_COLUMN}>Keep as item detail</SelectItem> : null}
                  {fields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                      {f.required ? " (required)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field?.hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{field.hint}</p> : null}
              {key === DETAIL_COLUMN ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Saved on each item as &quot;{header.trim() || `Column ${i + 1}`}&quot;</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
