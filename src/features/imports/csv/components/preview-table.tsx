"use client";

import { useState } from "react";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CSV_FIELDS, fieldLabel, type CsvImportKind } from "../fields";
import type { PreviewRow } from "../schemas";
import { willImport } from "../review";

const PAGE = 200;

const STATUS: Record<PreviewRow["status"], { label: string; tone: Tone }> = {
  ready: { label: "Ready", tone: "success" },
  error: { label: "Needs a fix", tone: "danger" },
  duplicate: { label: "Duplicate", tone: "warning" },
  skip: { label: "Nothing to add", tone: "neutral" },
};

const ACTION: Record<NonNullable<PreviewRow["item"]>["action"], string> = {
  create: "New item",
  purchase: "Adds stock",
  update: "Fills details",
  skip: "No change",
};

/**
 * The dry run as a table: one line per row of the file, every mapped column, the cells with a
 * problem highlighted and the problem named under them. Scrolls inside its own box on small screens.
 */
export function PreviewTable({
  kind,
  rows,
  mappedKeys,
  detailLabels = [],
  importDuplicates,
}: {
  kind: CsvImportKind;
  rows: PreviewRow[];
  mappedKeys: string[];
  /** Items: columns kept as details, shown after the fields under their own headers. */
  detailLabels?: string[];
  importDuplicates: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  // Fields in file-independent order, then each detail column ("detail:<header>").
  const columns = [
    ...CSV_FIELDS[kind].filter((f) => mappedKeys.includes(f.key) || (kind === "items" && f.key === "sku")).map((f) => ({ key: f.key, label: f.label })),
    ...detailLabels.map((label) => ({ key: `detail:${label}`, label })),
  ];
  const visible = rows.slice(0, shown);

  if (!rows.length) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No rows match this filter.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="max-h-[60vh] overflow-auto rounded-lg border" role="region" aria-label="Rows to import" tabIndex={0}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <Th className="sticky left-0 z-10 bg-muted">Row</Th>
              <Th>Status</Th>
              {kind === "items" ? <Th>What happens</Th> : null}
              {kind === "items" ? <Th className="text-right">Expense</Th> : null}
              {columns.map((c) => (
                <Th key={c.key} className={cn(isMoney(c.key) && "text-right")}>
                  {c.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const errorFields = new Set(row.errors.map((e) => e.field));
              const included = willImport(row, importDuplicates);
              return (
                <tr key={row.line} className={cn("align-top", !included && "text-muted-foreground")}>
                  <Td className="sticky left-0 bg-card font-mono text-xs tabular-nums">{row.line}</Td>
                  <Td className="max-w-72 min-w-36">
                    <StatusBadge tone={row.status === "duplicate" && importDuplicates ? "info" : STATUS[row.status].tone}>
                      {row.status === "duplicate" && importDuplicates ? "Duplicate, imported" : STATUS[row.status].label}
                    </StatusBadge>
                    {row.errors.length ? (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-danger">
                        {row.errors.map((e) => (
                          <li key={e.field + e.message}>
                            <span className="font-medium">{fieldLabel(kind, e.field)}:</span> {e.message}
                          </li>
                        ))}
                      </ul>
                    ) : row.reason ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">{row.reason}</p>
                    ) : null}
                  </Td>
                  {kind === "items" ? (
                    <>
                      <Td className="whitespace-nowrap">
                        {row.status === "error" || (row.status === "duplicate" && !included) ? "Not saved" : row.item ? ACTION[row.item.action] : ""}
                        {row.item?.existing && row.status !== "error" ? (
                          <p className="max-w-56 truncate text-xs text-muted-foreground" title={row.item.existing.name}>
                            {row.item.existing.name}
                          </p>
                        ) : null}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">
                        {!included || !row.amount ? <span className="text-muted-foreground">None</span> : formatCurrency(row.amount)}
                      </Td>
                    </>
                  ) : null}
                  {columns.map((c) => {
                    const error = errorFields.has(c.key);
                    const note = row.notes[c.key];
                    return (
                      <Td
                        key={c.key}
                        className={cn(
                          "max-w-64 min-w-24",
                          isMoney(c.key) && "text-right tabular-nums",
                          error && "bg-danger/10 text-danger ring-1 ring-danger/30 ring-inset",
                        )}
                      >
                        <span className="line-clamp-2 [overflow-wrap:anywhere]" title={row.shown[c.key]}>
                          {row.shown[c.key] || <span className="text-muted-foreground">·</span>}
                        </span>
                        {note && !error ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{note}</span> : null}
                      </Td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {shown} of {rows.length} rows
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown)} more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const MONEY = new Set(["amount", "taxableAmount", "cgst", "sgst", "igst", "cess", "gstTotal", "unitPrice", "quantity", "minStock"]);
const isMoney = (key: string) => MONEY.has(key);

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn("border-b px-3 py-2 font-medium whitespace-nowrap", className)}>{children}</th>;
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn("border-b px-3 py-2", className)}>{children}</td>;
}
