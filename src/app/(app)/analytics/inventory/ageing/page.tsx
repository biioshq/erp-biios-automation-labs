import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, CalendarClock, Hourglass, PackageX, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCompactCurrency, formatPercent } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { DEFAULT_AGE_EDGES, ageEdgesParam } from "@/features/analytics/inventory/params";
import { getAgeing } from "@/features/analytics/inventory/ageing-queries";
import { AgeEdgesInput } from "@/features/analytics/inventory/components/controls";
import { MoneyBars } from "@/features/analytics/inventory/components/charts";
import { NotRecorded, RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { AgeingTable, BucketTable, LongPendingTable } from "@/features/analytics/inventory/components/ageing-sections";

export const metadata: Metadata = { title: "Inventory ageing" };

export default async function AgeingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.inventory)) return <NoAccess eyebrow="Analytics & Planning" title="Inventory ageing" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const edges = ageEdgesParam(await searchParams);
  const isDefault = edges.join(",") === DEFAULT_AGE_EDGES.join(",");
  const data = await getAgeing(edges);
  const oldest = data.totals[data.totals.length - 1];
  // Phone axis labels: "0-30", "Over 90" (the tooltip keeps the full band name).
  const chart = data.totals.map((t) => ({ label: t.label, short: t.label.replace(/ days$/, "").replace(/^More than /, "Over "), value: t.value, old: t.key === oldest.key }));
  const summary = `Stock value by age. ${data.totals.map((t) => `${t.label}: ${formatCompactCurrency(t.value)}`).join("; ")}.`;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Inventory ageing"
        description="How long the stock in storage has been held, by the dates it was purchased, with its value in each age band."
        actions={
          open("/analytics/inventory/velocity") ? (
            <Button asChild variant="outline">
              <Link href="/analytics/inventory/velocity">
                <Boxes /> Fast and slow moving
              </Link>
            </Button>
          ) : null
        }
      />
      <AgeEdgesInput key={edges.join(",")} edges={edges} isDefault={isDefault} />

      {data.rows.length === 0 ? (
        <EmptyState icon={Warehouse} title="Nothing in storage" description="No active item has stock available in storage, so there is nothing to age." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Stock in storage" icon={Warehouse} tone="brand" value={<Money value={data.totalValue} />} hint={plural(data.rows.length, "material", "materials")} />
            <StatCard
              label={`Held more than ${edges[edges.length - 1]} days`}
              icon={Hourglass}
              tone={oldest.value > 0 ? "warning" : "success"}
              value={<Money value={oldest.value} />}
              hint={data.totalValue > 0 ? `${formatPercent(oldest.value / data.totalValue)} of the value, ${plural(oldest.items, "material", "materials")}` : undefined}
            />
            <StatCard label={data.totals[0].label} icon={CalendarClock} tone="success" value={<Money value={data.totals[0].value} />} hint={plural(data.totals[0].items, "material", "materials")} />
            <StatCard
              label="Age not recorded"
              icon={PackageX}
              tone="default"
              value={<Money value={data.undated.value} />}
              hint={data.undated.items ? plural(data.undated.items, "material", "materials") : "Every unit matched to a purchase"}
            />
          </StatGrid>

          <NotRecorded title="How ages are worked out">
            The ledger keeps no batch numbers, so ages assume first in, first out: the units in storage now are taken to be the most recent purchases,
            older ones having been used first. Each unit&apos;s age is the days since that purchase. Units no recorded purchase covers (added by a count
            adjustment, or entered as opening stock already on hand, whose purchase date is unknown) show as &quot;age not recorded&quot;. Stock in use on projects is not aged here. Values
            are at each item&apos;s average cost, so they add up to the inventory value.
          </NotRecorded>

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <Section title="Value by age" description="Stock value held in each age band.">
              <MoneyBars data={chart} labelKey="label" series={[{ key: "value", label: "Stock value", color: "var(--chart-1)" }]} highlightKey="old" phoneLabelKey="short" summary={summary} />
            </Section>
            <Section title="Totals per age band" description="Materials and value in each band. A material can sit in more than one." contentClassName="p-0 sm:p-0">
              <BucketTable totals={data.totals} undated={data.undated} totalValue={data.totalValue} />
            </Section>
          </div>

          <Section
            title="Long-pending stock"
            description={`Materials holding units bought more than ${edges[edges.length - 1]} days ago, largest value first.`}
            contentClassName="p-0 sm:p-0"
          >
            {data.longPending.length ? (
              <LongPendingTable rows={data.longPending} bucketKey={data.oldestBucketKey} />
            ) : (
              <EmptyState compact className="m-4" icon={Hourglass} title={`No stock older than ${edges[edges.length - 1]} days`} />
            )}
          </Section>

          <Section title="Ageing by material" description="Units in each age band, oldest stock first." contentClassName="p-0 sm:p-0">
            <AgeingTable rows={data.rows} buckets={data.buckets} />
          </Section>
          <RuleNote>Change the bucket edges above, for example 15, 45, 90, 180. They must be whole days in rising order.</RuleNote>
        </>
      )}
    </Page>
  );
}
