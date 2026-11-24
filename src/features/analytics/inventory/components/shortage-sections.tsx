import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import type { ShortageRow } from "../shortage-queries";
import { GridTable, ItemCell, ProjectCell, Qty, WrapHead, plural, type Column } from "./table-kit";

/** Tables of the shortage risk page. Server components. */

const LEVEL: Record<ShortageRow["level"], { label: string; className: string }> = {
  out: { label: "Out of stock", className: "bg-danger/10 text-danger" },
  below_min: { label: "At or below minimum", className: "bg-warning/12 text-warning" },
  runs_out: { label: "Runs out soon", className: "bg-warning/12 text-warning" },
  watch: { label: "Watch", className: "bg-info/10 text-info" },
};

const day = (d: string | null) => (d ? <span className="whitespace-nowrap">{formatDate(fromDateInput(d))}</span> : <span className="text-muted-foreground">No rate</span>);

function Projects({ rows }: { rows: ShortageRow["projects"] }) {
  if (!rows.length) return <span className="block min-w-28 text-xs whitespace-normal text-muted-foreground">None used it recently</span>;
  return (
    <div className="flex min-w-40 max-w-60 flex-wrap gap-1">
      {rows.slice(0, 3).map((p) => (
        <Link
          key={p.id}
          href={`/finance/projects/${p.id}`}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-xs hover:bg-muted"
          title={`${p.name}: ${formatNumber(p.consumed)} used in the window`}
        >
          <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="truncate">{p.name}</span>
        </Link>
      ))}
      {rows.length > 3 ? <span className="text-xs text-muted-foreground">and {rows.length - 3} more</span> : null}
    </div>
  );
}

export function ShortageTable({ rows, withSuggestion }: { rows: ShortageRow[]; withSuggestion?: boolean }) {
  const columns: Column<ShortageRow>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
    {
      key: "level",
      header: "Risk",
      cell: (r) => (
        <div className="space-y-1">
          <Badge variant="secondary" className={LEVEL[r.level].className}>
            {LEVEL[r.level].label}
          </Badge>
          <p className="max-w-48 text-xs whitespace-normal text-muted-foreground">{r.reasons.join(". ")}</p>
        </div>
      ),
    },
    { key: "available", header: "In storage", align: "right", cell: (r) => <Qty value={r.available} unit={r.unit} /> },
    {
      key: "rate",
      header: <WrapHead>Use a month</WrapHead>,
      align: "right",
      cell: (r) => (r.perDay ? <Qty value={Math.round(r.perDay * 30 * 100) / 100} unit={r.unit} /> : <span className="text-muted-foreground">No use</span>),
    },
    {
      key: "cover",
      header: <WrapHead>Days of cover</WrapHead>,
      align: "right",
      cell: (r) => (r.daysOfCover === null ? <span className="text-muted-foreground">No rate</span> : formatNumber(Math.floor(r.daysOfCover))),
    },
    { key: "stockout", header: <WrapHead>Estimated stockout</WrapHead>, cell: (r) => day(r.stockoutDate) },
    { key: "orderBy", header: "Order by", cell: (r) => day(r.orderBy) },
    ...(withSuggestion
      ? [
          {
            key: "suggested",
            header: <WrapHead>Suggested order</WrapHead>,
            align: "right" as const,
            cell: (r: ShortageRow) => (r.suggestedQty ? <Qty value={r.suggestedQty} unit={r.unit} className="font-medium" /> : <span className="text-muted-foreground">None</span>),
          },
        ]
      : []),
    { key: "projects", header: <WrapHead>Projects potentially affected</WrapHead>, cell: (r) => <Projects rows={r.projects} /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={960} />;
}

export function AffectedProjectsTable({ rows }: { rows: { id: string; name: string; code: string; color: string; items: number }[] }) {
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.id} name={r.name} code={r.code} color={r.color} /> },
    { key: "items", header: "Materials at risk it uses", align: "right", cell: (r) => plural(r.items, "material", "materials") },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={360} />;
}
