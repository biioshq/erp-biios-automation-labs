import { Money } from "@/components/shared/money";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import type { LevelRow } from "../levels-queries";
import { GridTable, ItemCell, Qty, type Column } from "./table-kit";

/** Tables of the overstock and understock page. Server components. */

const item: Column<LevelRow> = { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> };
const available: Column<LevelRow> = { key: "available", header: "In storage", align: "right", cell: (r) => <Qty value={r.available} unit={r.unit} /> };
const perMonth = (r: LevelRow) => (r.perDay ? <Qty value={Math.round(r.perDay * 30 * 100) / 100} unit={r.unit} /> : <span className="text-muted-foreground">No use</span>);
const rate: Column<LevelRow> = { key: "rate", header: "Use a month", align: "right", cell: perMonth };
const cover: Column<LevelRow> = {
  key: "cover",
  header: "Days of cover",
  align: "right",
  cell: (r) => (r.daysOfCover === null ? <span className="text-muted-foreground">No rate</span> : formatNumber(Math.floor(r.daysOfCover))),
};
const day = (d: string | null) => (d ? <span className="whitespace-nowrap">{formatDate(fromDateInput(d))}</span> : <span className="text-muted-foreground">Never</span>);

export function ExcessTable({ rows, windowDays }: { rows: LevelRow[]; windowDays: number }) {
  const columns: Column<LevelRow>[] = [
    item,
    available,
    rate,
    cover,
    { key: "excess", header: "Excess units", align: "right", cell: (r) => <Qty value={r.excessQty} unit={r.unit} /> },
    { key: "value", header: "Excess value", align: "right", cell: (r) => <Money value={r.excessValue} className="font-medium" /> },
    {
      key: "why",
      header: "Why",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.excessReason === "cover" ? "Lasts longer than the limit" : `No use in ${windowDays} days, above minimum`}</span>
      ),
    },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={820} />;
}

export function BelowMinimumTable({ rows }: { rows: LevelRow[] }) {
  const columns: Column<LevelRow>[] = [
    item,
    available,
    { key: "min", header: "Minimum", align: "right", cell: (r) => <Qty value={r.minStock} unit={r.unit} /> },
    { key: "short", header: "Short by", align: "right", cell: (r) => <Qty value={Math.max(0, Math.round((r.minStock - r.available) * 1000) / 1000)} unit={r.unit} /> },
    rate,
    cover,
    { key: "vendor", header: "Vendor", hideOnPhone: true, cell: (r) => r.vendor ?? <span className="text-muted-foreground">None</span> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={720} />;
}

export function ReorderTable({ rows }: { rows: LevelRow[] }) {
  const columns: Column<LevelRow>[] = [
    item,
    available,
    { key: "min", header: "Minimum", align: "right", cell: (r) => <Qty value={r.minStock} unit={r.unit} /> },
    { key: "lead", header: "Lead time", align: "right", cell: (r) => `${formatNumber(r.leadTimeDays ?? 0)} days` },
    { key: "reorder", header: "Reorder level", align: "right", cell: (r) => <Qty value={r.reorderLevel} unit={r.unit} className="font-medium" /> },
    cover,
    { key: "orderBy", header: "Order by", cell: (r) => day(r.orderBy) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={760} />;
}

export function CoverTable({ rows }: { rows: LevelRow[] }) {
  const columns: Column<LevelRow>[] = [
    item,
    available,
    rate,
    cover,
    { key: "lead", header: "Lead time", align: "right", cell: (r) => (r.leadTimeDays === null ? <span className="text-muted-foreground">Not recorded</span> : `${formatNumber(r.leadTimeDays)} days`) },
    { key: "stockout", header: "Runs out", cell: (r) => day(r.stockoutDate) },
    { key: "orderBy", header: "Order by", cell: (r) => day(r.orderBy) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={760} />;
}

export function IdleStockTable({ rows }: { rows: LevelRow[] }) {
  const columns: Column<LevelRow>[] = [
    item,
    available,
    { key: "value", header: "Stock value", align: "right", cell: (r) => <Money value={r.value} className="font-medium" /> },
    { key: "last", header: "Last issued", cell: (r) => day(r.lastIssue) },
    { key: "bought", header: "Last purchase", hideOnPhone: true, cell: (r) => day(r.lastPurchaseDate) },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={600} />;
}

export function OverboughtTable({ rows }: { rows: LevelRow[] }) {
  const columns: Column<LevelRow>[] = [
    item,
    { key: "bought", header: "Purchased", align: "right", cell: (r) => <Qty value={r.purchasedQty} unit={r.unit} /> },
    { key: "used", header: "Consumed", align: "right", cell: (r) => <Qty value={r.consumed} unit={r.unit} /> },
    { key: "share", header: "Used of purchased", align: "right", cell: (r) => formatPercent(r.purchasedQty > 0 ? r.consumed / r.purchasedQty : 0) },
    available,
    { key: "value", header: "Stock value", align: "right", cell: (r) => <Money value={r.value} /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={700} />;
}
