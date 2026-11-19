"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSearch } from "lucide-react";
import { motion } from "motion/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ColumnType, ReportCell, ReportColumn, ReportPreview, ReportPreviewSection, ReportRow, SummaryItem } from "../types";

function Value({ type, value, bold }: { type: ColumnType; value: ReportCell; bold?: boolean }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground/50">-</span>;
  if (type === "money" && typeof value === "number") return <Money value={value} className={cn(bold && "font-semibold")} />;
  if (type === "percent" && typeof value === "number") return <span className="tabular">{formatPercent(value)}</span>;
  if (type === "number" && typeof value === "number") return <span className="tabular">{formatNumber(value)}</span>;
  if (type === "date" && typeof value === "string") return <span className="whitespace-nowrap text-muted-foreground">{formatDate(fromDateInput(value))}</span>;
  return <span className="whitespace-pre">{String(value)}</span>;
}

export function SummaryTile({ item }: { item: SummaryItem }) {
  const negative = typeof item.value === "number" && item.value < 0;
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-3 shadow-card sm:px-4 sm:py-3.5">
      <p className="eyebrow">{item.label}</p>
      <p className={cn("tabular mt-1.5 text-lg leading-tight sm:text-xl font-semibold tracking-tight", negative && "text-danger")}>
        <Value type={item.type ?? (typeof item.value === "number" ? "number" : "text")} value={item.value} />
      </p>
    </div>
  );
}

function toColumns(columns: ReportColumn[]): ColumnDef<ReportRow>[] {
  return columns.map((c, index) => {
    const right = c.type !== "text" && c.type !== "date";
    return {
      id: c.key,
      accessorFn: (row) => row[c.key] ?? null,
      meta: { label: c.header, align: right ? "right" : "left", className: index === 0 ? "min-w-40" : undefined },
      header: ({ column }) => <DataTableColumnHeader column={column} title={c.header} align={right ? "right" : undefined} />,
      cell: ({ row }) => <Value type={c.type} value={row.original[c.key]} bold={row.original._kind === "subtotal"} />,
      sortingFn: right ? "basic" : "alphanumeric",
    } satisfies ColumnDef<ReportRow>;
  });
}

function TotalsStrip({ section }: { section: ReportPreviewSection }) {
  if (!section.totals) return null;
  const items = section.columns.filter((c) => c.type !== "text" && c.type !== "date" && typeof section.totals![c.key] === "number");
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-muted/30 px-4 py-3 sm:flex sm:flex-wrap sm:gap-x-8">
      {items.map((c) => (
        <div key={c.key} className="min-w-0">
          <dt className="eyebrow">Total {c.header.toLowerCase()}</dt>
          <dd className="mt-0.5 text-sm font-semibold">
            <Value type={c.type} value={section.totals![c.key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SectionTable({ id, section }: { id: string; section: ReportPreviewSection }) {
  const columns = useMemo(() => toColumns(section.columns), [section.columns]);
  if (!section.rows.length) {
    return <EmptyState compact icon={FileSearch} title="Nothing to report" description="No entries match these filters. Widen the period or clear a filter." />;
  }
  return (
    <div className="space-y-3">
      <DataTable
        id={id}
        columns={columns}
        data={section.rows}
        pageSize={20}
        searchPlaceholder="Search this preview..."
        rowClassName={(r) => (r._kind === "subtotal" ? "bg-muted/40" : undefined)}
      />
      {section.totalRows > section.rows.length ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {formatNumber(section.rows.length)} of {formatNumber(section.totalRows)} rows. Downloads contain every row.
        </p>
      ) : null}
      <TotalsStrip section={section} />
    </div>
  );
}

/** Summary tiles plus the first rows of each table of a report. */
export function ReportPreviewView({ preview }: { preview: ReportPreview }) {
  const [active, setActive] = useState(0);
  const section = preview.sections[Math.min(active, preview.sections.length - 1)];
  const multi = preview.sections.length > 1;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {preview.summary.map((item) => (
          <SummaryTile key={item.label} item={item} />
        ))}
      </div>
      {multi ? (
        <Tabs value={String(active)} onValueChange={(v) => setActive(Number(v))} className="gap-0">
          <div className="max-w-full overflow-x-auto">
            <TabsList>
              {preview.sections.map((s, i) => (
                <TabsTrigger key={s.title} value={String(i)}>
                  {s.title}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      ) : null}
      <SectionTable key={`${preview.type}-${active}`} id={`report-${preview.type}-${active}`} section={section} />
    </motion.div>
  );
}
