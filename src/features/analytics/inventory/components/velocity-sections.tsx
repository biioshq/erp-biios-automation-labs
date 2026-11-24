import { Money } from "@/components/shared/money";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import type { VelocityRow } from "../velocity-queries";
import { GridTable, ItemCell, Qty, type Column } from "./table-kit";

/** Tables of the fast / slow moving page. Server components. */

const lastIssue = (r: VelocityRow) => (r.lastIssue ? <span className="whitespace-nowrap">{formatDate(fromDateInput(r.lastIssue))}</span> : <span className="text-muted-foreground">Never issued</span>);

/** Moving items: how often and how much of their stock was used. */
export function VelocityTable({ rows }: { rows: VelocityRow[] }) {
  const columns: Column<VelocityRow>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
    { key: "cat", header: "Category", hideOnPhone: true, cell: (r) => r.categoryName ?? <span className="text-muted-foreground">None</span> },
    { key: "issues", header: "Issues", align: "right", cell: (r) => formatNumber(r.issues) },
    { key: "rate", header: "Issues a month", align: "right", cell: (r) => formatNumber(r.issuesPerMonth) },
    { key: "consumed", header: "Consumed", align: "right", cell: (r) => <Qty value={r.consumed} unit={r.unit} /> },
    { key: "share", header: "Share of stock used", align: "right", cell: (r) => formatPercent(r.shareUsed) },
    { key: "available", header: "In storage", align: "right", cell: (r) => <Qty value={r.available} unit={r.unit} /> },
    { key: "last", header: "Last issue", cell: lastIssue },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={820} />;
}

/** Items with stock and no issue: the value tied up in them. */
export function IdleTable({ rows, withMovements }: { rows: VelocityRow[]; withMovements?: boolean }) {
  const columns: Column<VelocityRow>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
    { key: "cat", header: "Category", hideOnPhone: true, cell: (r) => r.categoryName ?? <span className="text-muted-foreground">None</span> },
    { key: "available", header: "In storage", align: "right", cell: (r) => <Qty value={r.available} unit={r.unit} /> },
    { key: "value", header: "Stock value", align: "right", cell: (r) => <Money value={r.value} /> },
    ...(!withMovements ? [] : [{ key: "moves", header: "Other movements", align: "right" as const, cell: (r: VelocityRow) => formatNumber(r.movements) }]),
    { key: "last", header: "Last issue", cell: lastIssue },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={620} />;
}

export function FrequencyTable({ rows, kind }: { rows: VelocityRow[]; kind: "purchased" | "consumed" }) {
  const columns: Column<VelocityRow>[] =
    kind === "purchased"
      ? [
          { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
          { key: "n", header: "Purchases", align: "right", cell: (r) => formatNumber(r.purchases) },
          { key: "qty", header: "Units bought", align: "right", cell: (r) => <Qty value={r.purchasedQty} unit={r.unit} /> },
        ]
      : [
          { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
          { key: "n", header: "Issues", align: "right", cell: (r) => formatNumber(r.issues) },
          { key: "qty", header: "Consumed", align: "right", cell: (r) => <Qty value={r.consumed} unit={r.unit} /> },
        ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={360} />;
}
