import Link from "next/link";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { MOVEMENT_TYPES, labelOf } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { DepartmentWastage, HistoryRow, MaterialMovement, ProjectConsumption, YearFlow } from "../movement-queries";
import { FooterRow, GridTable, ItemCell, ProjectCell, Qty, type Column } from "./table-kit";

/** Tables of the stock movement analysis page. Server components. */

const sum = <T,>(rows: T[], pick: (r: T) => number) => Math.round(rows.reduce((s, r) => s + pick(r), 0) * 100) / 100;

export function ProjectConsumptionTable({ rows }: { rows: ProjectConsumption[] }) {
  const columns: Column<ProjectConsumption>[] = [
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.projectId} name={r.name} code={r.code} color={r.color} /> },
    { key: "issues", header: "Issues", align: "right", hideOnPhone: true, cell: (r) => formatNumber(r.issues) },
    { key: "issued", header: "Issued", align: "right", cell: (r) => <Money value={r.issued} /> },
    { key: "returned", header: "Returned", align: "right", cell: (r) => <Money value={r.returned} /> },
    { key: "net", header: "Net consumed", align: "right", cell: (r) => <Money value={r.net} className="font-medium" /> },
    { key: "wasted", header: "Wasted on site", align: "right", hideOnPhone: true, cell: (r) => <Money value={r.wasted} /> },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.projectId}
      minWidth={520}
      footer={
        <FooterRow
          cells={[
            { content: "Total" },
            { content: formatNumber(rows.reduce((s, r) => s + r.issues, 0)), align: "right", className: "hidden sm:table-cell" },
            { content: <Money value={sum(rows, (r) => r.issued)} />, align: "right" },
            { content: <Money value={sum(rows, (r) => r.returned)} />, align: "right" },
            { content: <Money value={sum(rows, (r) => r.net)} />, align: "right" },
            { content: <Money value={sum(rows, (r) => r.wasted)} />, align: "right", className: "hidden sm:table-cell" },
          ]}
        />
      }
    />
  );
}

export function DepartmentWastageTable({ rows }: { rows: DepartmentWastage[] }) {
  const columns: Column<DepartmentWastage>[] = [
    { key: "dept", header: "Department", cell: (r) => <span className={r.department ? "font-medium" : "text-muted-foreground"}>{r.label}</span> },
    { key: "count", header: "Write-offs", align: "right", cell: (r) => formatNumber(r.count) },
    { key: "value", header: "Value wasted", align: "right", cell: (r) => <Money value={r.value} className="font-medium" /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.department ?? "none"} minWidth={320} />;
}

export function YearFlowTable({ rows, current }: { rows: YearFlow[]; current: string }) {
  const columns: Column<YearFlow>[] = [
    {
      key: "fy",
      header: "Financial year",
      cell: (r) => (
        <span className="font-medium">
          {r.label}
          {r.label === current ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(current)</span> : null}
        </span>
      ),
    },
    { key: "received", header: "Received", align: "right", cell: (r) => <Money value={r.received} /> },
    { key: "issued", header: "Issued", align: "right", cell: (r) => <Money value={r.issued} /> },
    { key: "returned", header: "Returned", align: "right", hideOnPhone: true, cell: (r) => <Money value={r.returned} /> },
    { key: "wasted", header: "Wasted", align: "right", hideOnPhone: true, cell: (r) => <Money value={r.wasted} /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.label} minWidth={420} />;
}

export function MaterialMovementTable({ rows, historyHref }: { rows: MaterialMovement[]; historyHref: (itemId: string) => string }) {
  const columns: Column<MaterialMovement>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.itemId} name={r.name} sku={r.sku} archived={r.archived} /> },
    { key: "received", header: "Received", align: "right", cell: (r) => <Qty value={r.received} unit={r.unit} /> },
    ...(rows.some((r) => r.opening > 0)
      ? [{ key: "opening", header: "Opening stock", align: "right" as const, cell: (r: MaterialMovement) => (r.opening ? <Qty value={r.opening} unit={r.unit} /> : <span className="text-muted-foreground">None</span>) }]
      : []),
    { key: "issued", header: "Issued", align: "right", cell: (r) => <Qty value={r.issued} unit={r.unit} /> },
    { key: "returned", header: "Returned", align: "right", cell: (r) => <Qty value={r.returned} unit={r.unit} /> },
    { key: "wasted", header: "Wasted", align: "right", cell: (r) => <Qty value={r.wasted} unit={r.unit} /> },
    {
      key: "adjusted",
      header: "Adjusted",
      align: "right",
      cell: (r) => (r.adjusted === 0 ? <span className="text-muted-foreground">None</span> : <Qty value={r.adjusted} unit={r.unit} />),
    },
    { key: "moves", header: "Location moves", align: "right", cell: (r) => formatNumber(r.relocations) },
    { key: "net", header: "Net consumed", align: "right", cell: (r) => <Money value={r.netIssuedValue} /> },
    { key: "last", header: "Last movement", cell: (r) => <span className="whitespace-nowrap">{formatDate(fromDateInput(r.lastDay))}</span> },
    {
      key: "history",
      header: <span className="sr-only">History</span>,
      cell: (r) => (
        <Button asChild variant="ghost" size="sm">
          <Link href={`${historyHref(r.itemId)}#movement-history`}>
            <History /> History
          </Link>
        </Button>
      ),
    },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.itemId} minWidth={1040} />;
}

const TYPE_TONE: Record<string, string> = {
  purchase: "bg-success/10 text-success",
  assign: "bg-brand/10 text-brand-ink",
  return: "bg-info/10 text-info",
  wastage: "bg-danger/10 text-danger",
  adjustment: "bg-warning/12 text-warning",
  transfer: "bg-muted text-foreground",
};

function typeLabel(r: HistoryRow): string {
  if (r.openingOnHand) return "Opening stock (already on hand)";
  if (r.moveHalf) return r.type === "return" ? "Moved out (to another project)" : "Moved in (from another project)";
  if (r.type === "wastage") return r.wastageFrom === "project" ? "Wasted on site" : "Wasted in storage";
  if (r.type === "adjustment") return r.availableDelta >= 0 ? "Adjusted up" : "Adjusted down";
  return labelOf(MOVEMENT_TYPES, r.type);
}

export function HistoryTable({ rows, unit }: { rows: HistoryRow[]; unit: string }) {
  if (!rows.length) {
    return <EmptyState compact icon={History} title="No movements in this range" description="Pick a wider date range to see older movements of this material." />;
  }
  const columns: Column<HistoryRow>[] = [
    { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap">{formatDate(fromDateInput(r.day))}</span> },
    {
      key: "type",
      header: "Movement",
      cell: (r) => (
        <Badge variant="secondary" className={TYPE_TONE[r.type]}>
          {typeLabel(r)}
        </Badge>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      align: "right",
      cell: (r) =>
        r.type === "transfer" ? (
          <span className="text-muted-foreground">Location only</span>
        ) : (
          <Qty value={r.type === "adjustment" ? r.availableDelta : r.quantity} unit={unit} />
        ),
    },
    { key: "value", header: "Value", align: "right", cell: (r) => (r.type === "transfer" ? <span className="text-muted-foreground">None</span> : <Money value={r.value} />) },
    { key: "project", header: "Project", cell: (r) => (r.project ? <Link href={`/finance/projects/${r.project.id}`} className="hover:underline">{r.project.name}</Link> : <span className="text-muted-foreground">Storage</span>) },
    { key: "balance", header: "In storage after", align: "right", cell: (r) => <Qty value={r.balanceAvailable} unit={unit} /> },
    { key: "note", header: "Note", cell: (r) => <span className="block max-w-64 truncate text-muted-foreground">{r.note ?? ""}</span> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={860} />;
}
