import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn, ChartLine, Hammer, Layers, PackagePlus, ShoppingCart, Store, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatNumber } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { getProcurementInsights } from "@/features/analytics/insights/procurement";
import { DEFAULT_PERIOD, parsePeriod } from "@/features/analytics/insights/period";
import { DetailsLink, Footnote, NotRecorded } from "@/features/analytics/dashboard/components/bits";
import { MonthChart, PriceChart } from "@/features/analytics/dashboard/components/charts";
import { PeriodLinks } from "@/features/analytics/insights/components/period-links";
import { ItemPicker } from "@/features/analytics/insights/components/item-picker";
import { MaterialTable, PriceChangeTable, VendorTable } from "@/features/analytics/insights/components/tables";

export const metadata: Metadata = { title: "Procurement analysis" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.insights)) return <NoAccess eyebrow="Analytics & Planning" title="Procurement analysis" />;
  // A card or chart shows only when its page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const data = await getProcurementInsights(period, first(sp.item));
  const t = data.totals;
  const periodParam = period === DEFAULT_PERIOD ? null : period;
  const hasTrend = data.months.some((m) => m.stock > 0 || m.materials > 0 || m.equipment > 0);
  const itemHref = (id: string) => `/analytics/insights/procurement?${new URLSearchParams({ ...(periodParam ? { period: periodParam } : {}), item: id }).toString()}#price-trend`;
  const vendorHref = (key: string) => `/analytics/insights/vendors?${new URLSearchParams({ ...(periodParam ? { period: periodParam } : {}), vendor: key }).toString()}`;

  return (
    <Page>
      <PageHeader
        eyebrow="Management insights"
        title="Procurement analysis"
        description={`What was bought, from whom and at what price, over ${data.phrase}.`}
        actions={
          <>
            <PeriodLinks value={period} basePath="/analytics/insights/procurement" keep={{ item: first(sp.item) }} />
            {open("/inventory/purchase") ? (
              <Button asChild variant="outline">
                <Link href="/inventory/purchase">
                  <ShoppingCart /> Buy stock
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <StatCard label="Total purchase value" value={<Money value={t.value} />} icon={PackagePlus} tone="brand" hint={`${formatNumber(t.bills)} ${t.bills === 1 ? "bill" : "bills"}, GST included`} />
        <StatCard label="Stock bought" value={<Money value={t.stock} />} icon={Layers} tone="info" hint="Purchases through Buy stock" />
        <StatCard label="Material bills" value={<Money value={t.materials} />} icon={Tags} hint="Expenses in Materials, entered directly" />
        <StatCard label="Equipment bills" value={<Money value={t.equipment} />} icon={Hammer} hint="Expenses in Equipment" />
      </StatGrid>
      {t.opening > 0 ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Not counted as purchases: <Money value={t.opening} /> of opening or imported stock ({formatNumber(t.openingEntries)} {t.openingEntries === 1 ? "entry" : "entries"}) in this period. It was on hand before it
          was recorded, so no money was spent on it in the ERP.
        </p>
      ) : null}

      {open("/finance/expenses/summary") ? (
        <Section title="Purchase trend" description="Purchase value each month, by kind of bill." actions={<DetailsLink href="/finance/expenses/summary">Expense summary</DetailsLink>}>
          {hasTrend ? (
            <MonthChart
              title="Purchase value by month"
              data={data.months}
              series={[
                { key: "stock", label: "Stock bought", color: "var(--chart-1)", stack: "p" },
                { key: "materials", label: "Material bills", color: "var(--chart-2)", stack: "p" },
                { key: "equipment", label: "Equipment bills", color: "var(--chart-3)", stack: "p" },
              ]}
            />
          ) : (
            <EmptyState icon={ChartColumn} compact title="No purchases in this period" description="Buy stock, or record a Materials or Equipment expense, and it shows here." />
          )}
          <Footnote>
            A purchase is a stock purchase, or an expense in Materials or Equipment entered by hand or by a recurring schedule. Stock issued to projects and wastage are left out: that stock was bought
            already. Amounts are what the bills say, GST included.
          </Footnote>
        </Section>
      ) : null}

      {/* Stacked: both tables have six columns and do not fit half the page. */}
      <div className="grid gap-5 sm:gap-6">
        {open("/analytics/insights/vendors") ? (
          <Section title="Vendor-wise purchases" description="Purchase value per vendor. Open a vendor for its full history." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/insights/vendors">Vendor performance</DetailsLink>}>
            {data.vendors.length ? (
              <VendorTable rows={data.vendors} hrefOf={vendorHref} />
            ) : (
              <EmptyState icon={Store} compact className="m-4" title="No purchases from vendors in this period" />
            )}
          </Section>
        ) : null}
        {open("/inventory/items") ? (
          <Section title="Material-wise purchases" description="Stock bought per item, before GST, with the prices paid." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/inventory/items">Items</DetailsLink>}>
            {data.materials.length ? (
              <MaterialTable rows={data.materials} />
            ) : (
              <EmptyState icon={Layers} compact className="m-4" title="No stock bought in this period" description="Material and equipment bills are not split by item, so only stock purchases show here." />
            )}
          </Section>
        ) : null}
      </div>

      <div id="price-trend" className="scroll-mt-20">
        <Section
          title="Purchase price trend"
          description={data.priceItem ? `Price per ${data.priceItem.unit} paid for ${data.priceItem.name} on each recorded purchase, all time.` : "Price paid on each recorded purchase of an item."}
          actions={data.priceItem && data.priceItems.length > 1 ? <ItemPicker items={data.priceItems} value={data.priceItem.id} /> : null}
        >
          {data.priceItem && data.priceItem.points.length ? (
            <PriceChart title={`Price paid for ${data.priceItem.name}`} points={data.priceItem.points} unit={data.priceItem.unit} />
          ) : (
            <EmptyState icon={ChartLine} compact title="No priced purchases recorded" description="Prices come from stock purchases and opening stock entered with a unit price." />
          )}
          <Footnote>
            Every stock entry with a unit price counts. Opening and imported stock (marked in the tooltip) shows the unit price it was entered at, which may not be what was paid. Prices
            are before GST.
          </Footnote>
        </Section>
      </div>

      <Section title="Price changes" description="First and latest price per item with two or more priced purchases, biggest change first. Open an item to chart it." contentClassName="p-0 sm:p-0">
        {data.priceChanges.length ? (
          <PriceChangeTable rows={data.priceChanges} hrefOf={itemHref} />
        ) : (
          <EmptyState icon={Tags} compact className="m-4" title="No item has been bought twice yet" description="Price changes show once an item has two priced purchases." />
        )}
      </Section>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <NotRecorded
          title="Pending purchase orders: not recorded"
          description="The ERP records a purchase when the stock or bill arrives. It has no purchase orders, so it cannot list orders that are placed but not received."
        />
        <NotRecorded
          title="Delayed deliveries: not recorded"
          description="No order date or promised delivery date is kept for purchases, so delivery delays cannot be measured. See Vendor performance for what is recorded per vendor."
        />
      </div>
    </Page>
  );
}
