import { Money } from "@/components/shared/money";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { UNDATED, type AgeBucket, type AgeingRow, type BucketTotal } from "../ageing-queries";
import { FooterRow, GridTable, ItemCell, Qty, WrapHead, type Column } from "./table-kit";

/** Tables of the inventory ageing page. Server components. */

const day = (d: string | null) => (d ? <span className="whitespace-nowrap">{formatDate(fromDateInput(d))}</span> : <span className="text-muted-foreground">Not recorded</span>);

/** Stock value per age bucket, with the share of the total. */
export function BucketTable({ totals, undated, totalValue }: { totals: BucketTotal[]; undated: { value: number; items: number }; totalValue: number }) {
  const rows = [...totals.map((t) => ({ key: t.key, label: t.label, value: t.value, items: t.items })), ...(undated.items ? [{ key: UNDATED, label: "Age not recorded", value: undated.value, items: undated.items }] : [])];
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "label", header: "Age", cell: (r) => <span className={r.key === UNDATED ? "text-muted-foreground" : "font-medium"}>{r.label}</span> },
    { key: "items", header: "Materials", align: "right", cell: (r) => formatNumber(r.items) },
    { key: "value", header: "Stock value", align: "right", cell: (r) => <Money value={r.value} className="font-medium" /> },
    {
      key: "share",
      header: "Share",
      className: "w-36",
      cell: (r) => {
        const share = totalValue > 0 ? r.value / totalValue : 0;
        return (
          <div className="flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, share * 100)}%` }} />
            </span>
            <span className="tabular w-11 text-right text-xs text-muted-foreground">{Math.round(share * 100)}%</span>
          </div>
        );
      },
    },
  ];
  return (
    <GridTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.key}
      minWidth={380}
      footer={<FooterRow cells={[{ content: "Total in storage" }, { content: "" }, { content: <Money value={totalValue} />, align: "right" }, { content: "" }]} />}
    />
  );
}

/** One row per material: quantity in each bucket, dates and value. */
export function AgeingTable({ rows, buckets }: { rows: AgeingRow[]; buckets: AgeBucket[] }) {
  const hasUndated = rows.some((r) => r.undatedQty > 0);
  const columns: Column<AgeingRow>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
    { key: "qty", header: <WrapHead>In storage</WrapHead>, align: "right", cell: (r) => <Qty value={r.available} unit={r.unit} /> },
    ...buckets.map((b) => ({
      key: b.key,
      header: <WrapHead>{b.label}</WrapHead>,
      align: "right" as const,
      cell: (r: AgeingRow) => <Qty value={r.qtyByBucket[b.key] ?? 0} unit={r.unit} dashZero />,
    })),
    ...(hasUndated
      ? [
          {
            key: UNDATED,
            header: <WrapHead>Age not recorded</WrapHead>,
            align: "right" as const,
            cell: (r: AgeingRow) => <Qty value={r.undatedQty} unit={r.unit} dashZero />,
          },
        ]
      : []),
    { key: "avg", header: <WrapHead>Average age</WrapHead>, align: "right", cell: (r) => (r.averageAge === null ? <span className="text-muted-foreground">Not known</span> : `${formatNumber(r.averageAge)} days`) },
    {
      // Oldest and latest purchase still held, in one cell to keep the table within the page.
      key: "dates",
      header: "Purchases held",
      cell: (r) =>
        r.oldestDay ? (
          <div className="text-xs leading-5 whitespace-nowrap">
            <p>Oldest {formatDate(fromDateInput(r.oldestDay))}</p>
            {r.newestDay && r.newestDay !== r.oldestDay ? <p className="text-muted-foreground">Latest {formatDate(fromDateInput(r.newestDay))}</p> : null}
          </div>
        ) : (
          <span className="text-muted-foreground">Not recorded</span>
        ),
    },
    { key: "value", header: "Stock value", align: "right", cell: (r) => <Money value={r.value} className="font-medium" /> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={640 + buckets.length * 70} />;
}

/** Materials holding units older than the last edge. */
export function LongPendingTable({ rows, bucketKey }: { rows: AgeingRow[]; bucketKey: string }) {
  const columns: Column<AgeingRow>[] = [
    { key: "item", header: "Material", cell: (r) => <ItemCell id={r.id} name={r.name} sku={r.sku} /> },
    { key: "qty", header: "Old units", align: "right", cell: (r) => <Qty value={r.qtyByBucket[bucketKey]} unit={r.unit} /> },
    { key: "value", header: "Their value", align: "right", cell: (r) => <Money value={r.valueByBucket[bucketKey]} className="font-medium" /> },
    { key: "oldest", header: "Oldest purchase held", cell: (r) => day(r.oldestDay) },
    {
      key: "age",
      header: "Oldest age",
      align: "right",
      cell: (r) => (r.lots.length ? `${formatNumber(r.lots[r.lots.length - 1].age)} days` : <span className="text-muted-foreground">Not known</span>),
    },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={560} />;
}
