import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Layers, ReceiptText, Scale, Store, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer, userCanOpen } from "@/features/analytics/viewer";
import { getVendorInsights } from "@/features/analytics/insights/vendors";
import { DEFAULT_PERIOD, parsePeriod } from "@/features/analytics/insights/period";
import { DetailsLink, Footnote, NotRecorded } from "@/features/analytics/dashboard/components/bits";
import { PeriodLinks } from "@/features/analytics/insights/components/period-links";
import { BillsTable, ComparisonTable, VendorTable } from "@/features/analytics/insights/components/tables";
import type { VendorInsights } from "@/features/analytics/insights/types";

export const metadata: Metadata = { title: "Vendor performance" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function VendorHistory({ selected, backHref }: { selected: NonNullable<VendorInsights["selected"]>; backHref: string }) {
  const r = selected.row;
  return (
    <Section
      title={`History: ${selected.name}`}
      description={r ? "Every recorded bill and stock purchase from this vendor, up to the latest 100 of each." : "No bills in the selected period. Its latest bills and stock purchases from any time are listed below."}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={backHref} scroll={false}>
            <ArrowLeft /> All vendors
          </Link>
        </Button>
      }
      contentClassName="p-0 sm:p-0"
    >
      {r ? (
        <p className="px-4 pt-3 text-sm text-muted-foreground sm:px-5">
          In this period: <Money value={r.value} className="font-medium text-foreground" /> over {formatNumber(r.bills)} {r.bills === 1 ? "bill" : "bills"}
          {r.outstanding > 0 ? (
            <>
              , <Money value={r.outstanding} className="font-medium text-foreground" /> unpaid today
            </>
          ) : null}
          .
        </p>
      ) : null}
      <div className="mt-2">
        <p className="px-4 pb-1 text-xs font-medium text-muted-foreground sm:px-5">Bills, newest first</p>
        {selected.bills.length ? <BillsTable rows={selected.bills} /> : <EmptyState icon={ReceiptText} compact className="m-4" title="No bills from this vendor" />}
      </div>
      {selected.purchases.length ? (
        <div className="mt-4 border-t pt-3">
          <p className="px-4 pb-1 text-xs font-medium text-muted-foreground sm:px-5">Stock bought, newest first</p>
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.purchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/inventory/items/${p.itemId}`} className="font-medium hover:underline">
                      {p.item}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(fromDateInput(p.date))}</TableCell>
                  <TableCell className="tabular text-right">
                    {formatNumber(p.qty)} {p.unit}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={p.price} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={p.value} className="font-medium" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Section>
  );
}

export default async function VendorPerformancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.insights)) return <NoAccess eyebrow="Analytics & Planning" title="Vendor performance" />;
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const vendor = first(sp.vendor);
  const data = await getVendorInsights(period, vendor ?? null, analyticsViewer(user));
  // A card or chart shows only when its page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const t = data.totals;
  const periodParam = period === DEFAULT_PERIOD ? null : period;
  const base = "/analytics/insights/vendors";
  const vendorHref = (key: string) => `${base}?${new URLSearchParams({ ...(periodParam ? { period: periodParam } : {}), vendor: key }).toString()}#history`;
  const backHref = periodParam ? `${base}?period=${periodParam}` : base;

  return (
    <Page>
      <PageHeader
        eyebrow="Management insights"
        title="Vendor performance"
        description={`What is recorded about each supplier over ${data.phrase}: bills, value, prices and what is still unpaid.`}
        actions={<PeriodLinks value={period} basePath={base} keep={{ vendor: vendor ?? null }} />}
      />

      <StatGrid>
        <StatCard label="Orders placed" value={formatNumber(t.bills)} icon={ReceiptText} tone="brand" hint={`Supplier bills, ${formatNumber(t.stockPurchases)} of them stock purchases`} />
        <StatCard label="Value of orders" value={<Money value={t.value} />} icon={Wallet} hint="GST included" />
        <StatCard label="Vendors" value={formatNumber(t.vendors)} icon={Store} tone="info" hint="With a bill in this period" />
        <StatCard label="Unpaid to vendors today" value={<Money value={t.outstanding} />} icon={Scale} tone={t.outstanding > 0 ? "warning" : "default"} hint="Supplier bills, salaries left out" />
      </StatGrid>

      {vendor !== undefined ? (
        <div id="history" className="scroll-mt-20">
          {data.selected ? (
            <VendorHistory selected={data.selected} backHref={backHref} />
          ) : (
            <EmptyState
              icon={Store}
              compact
              title="No bills or purchases from this vendor"
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href={backHref}>All vendors</Link>
                </Button>
              }
            />
          )}
        </div>
      ) : null}

      {open("/finance/expenses") ? (
        <Section title="Vendor-wise history" description="Every supplier with a bill in this period, by value. Open a vendor for its bills and stock purchases." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/finance/expenses">Expenses</DetailsLink>}>
          {data.vendors.length ? (
            <>
              <VendorTable rows={data.vendors} hrefOf={vendorHref} showOutstanding />
              <Footnote className="px-4 pb-4 sm:px-5">
                A supplier bill is any expense entered by hand, by a recurring schedule or by a stock purchase, except salaries. Names are matched without regard to case or spacing.
              </Footnote>
            </>
          ) : (
            <EmptyState icon={Store} compact className="m-4" title="No supplier bills in this period" description="Pick a longer period, or record expenses with a vendor name." />
          )}
        </Section>
      ) : null}

      {open("/analytics/insights/procurement") ? (
        <Section title="Price comparison across vendors" description="Items bought from two or more vendors in this period: average and latest price each paid, cheapest first." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/insights/procurement">Procurement</DetailsLink>}>
          {data.comparisons.length ? (
            <>
              <ComparisonTable rows={data.comparisons} />
              <Footnote className="px-4 pb-4 sm:px-5">From stock entries with a unit price and a vendor name, before GST. Average price is value ÷ quantity.</Footnote>
            </>
          ) : (
            <EmptyState icon={Layers} compact className="m-4" title="No item bought from more than one vendor" description="When the same item is bought from two vendors, their prices are compared here." />
          )}
        </Section>
      ) : null}

      <NotRecorded
        title="On-time deliveries, delays, delivery times and rejected material: not recorded"
        description="A purchase is entered when the goods arrive. The ERP keeps no order date, promised delivery date or inspection result, so it cannot tell whether a delivery was late or how long it took, or count damaged and rejected material. Only bills, values and prices are measured here."
      />
    </Page>
  );
}
