import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Gauge, PackageMinus, PackagePlus, Snail, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { parseRange } from "@/features/analytics/inventory/params";
import { MIN_RANKED, getVelocity } from "@/features/analytics/inventory/velocity-queries";
import { RangeControl } from "@/features/analytics/inventory/components/controls";
import { RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { FrequencyTable, IdleTable, VelocityTable } from "@/features/analytics/inventory/components/velocity-sections";

export const metadata: Metadata = { title: "Fast and slow moving" };

export default async function VelocityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.inventory)) return <NoAccess eyebrow="Analytics & Planning" title="Fast and slow moving" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const range = parseRange(await searchParams, 90);
  const data = await getVelocity(range);
  const moving = data.fast.length + data.steady.length + data.slow.length;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Fast and slow moving materials"
        description="How often each material was issued to projects in the period and how much of its stock that used, with the materials that did not move at all."
        actions={
          open("/analytics/inventory/levels") ? (
            <Button asChild variant="outline">
              <Link href="/analytics/inventory/levels">
                <Gauge /> Overstock and understock
              </Link>
            </Button>
          ) : null
        }
      />
      <RangeControl from={range.from} to={range.to} isDefault={range.isDefault} defaultText="Last 90 days" />

      {data.itemCount === 0 ? (
        <EmptyState
          title="No inventory items yet"
          description="Add items and record purchases and issues; this page then shows which materials move fast and which sit in storage."
          action={
            open("/inventory/items?new=1") ? (
              <Button asChild variant="outline">
                <Link href="/inventory/items?new=1">Add an item</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Fast-moving" icon={Zap} tone="success" value={data.ranked ? data.fast.length : "Not split"} hint={plural(moving, "material issued", "materials issued")} />
            <StatCard label="Slow-moving" icon={Snail} tone="warning" value={data.ranked ? data.slow.length : "Not split"} hint={data.ranked ? `${data.steady.length} steady in between` : `Needs ${MIN_RANKED} or more issued materials`} />
            <StatCard
              label="Non-moving (no issue)"
              icon={PackageMinus}
              tone={data.nonMoving.length ? "danger" : "default"}
              value={data.nonMoving.length}
              hint={
                <>
                  <Money value={data.nonMovingValue} /> of stock in storage
                </>
              }
            />
            <StatCard label="No movement of any kind" icon={Ban} tone="default" value={data.noMovement.length} hint={`Of ${plural(data.itemCount, "active item", "active items")}`} />
          </StatGrid>

          <Section title="How materials are classed">
            <RuleNote className="text-sm">
              Consumption is units issued to projects less units returned, in {range.label}. Each material issued at least once gets two ranks: issues a
              month, and the share of its stock used (units consumed divided by units consumed plus units in storage now). The average of the two ranks
              orders them: the top third is fast-moving, the middle third steady and the bottom third slow-moving. Moves between projects are not counted
              as issues. Non-moving means stock in storage and no issue in the period; {plural(data.noStockNoIssue, "item", "items")} with no stock and no
              issue are left out.
            </RuleNote>
          </Section>

          {!data.ranked ? (
            <EmptyState
              icon={TrendingUp}
              title="Too few materials were issued to rank"
              description={`${plural(moving, "material was", "materials were")} issued in this period. Ranking into thirds needs at least ${MIN_RANKED}. Pick a longer range.`}
            />
          ) : (
            <>
              <Section title="Fast-moving" description="Issued most often and using the largest share of their stock." contentClassName="p-0 sm:p-0">
                <VelocityTable rows={data.fast} />
              </Section>
              <Section title="Steady" description="The middle third." contentClassName="p-0 sm:p-0">
                <VelocityTable rows={data.steady} />
              </Section>
              <Section title="Slow-moving" description="Issued, but rarely or in small amounts against the stock held." contentClassName="p-0 sm:p-0">
                <VelocityTable rows={data.slow} />
              </Section>
            </>
          )}

          <Section
            title="Non-moving materials"
            description={`Stock in storage with no issue to a project in the period, largest value first.${
              data.addedDuringPeriod ? ` ${plural(data.addedDuringPeriod, "item", "items")} first recorded during the period ${data.addedDuringPeriod === 1 ? "is" : "are"} left out: ${data.addedDuringPeriod === 1 ? "it was" : "they were"} not held the whole time.` : ""
            }`}
            contentClassName="p-0 sm:p-0"
          >
            {data.nonMoving.length ? (
              <IdleTable rows={data.nonMoving} withMovements />
            ) : (
              <EmptyState compact className="m-4" icon={PackageMinus} title="Every material in storage was issued in this period" />
            )}
          </Section>

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <Section title="Frequently purchased" description="Most purchases in the period, top 10." contentClassName="p-0 sm:p-0">
              {data.frequentlyPurchased.length ? (
                <FrequencyTable rows={data.frequentlyPurchased} kind="purchased" />
              ) : (
                <EmptyState compact className="m-4" icon={PackagePlus} title="No purchases in this period" />
              )}
            </Section>
            <Section title="Frequently consumed" description="Most issues to projects in the period, top 10." contentClassName="p-0 sm:p-0">
              {data.frequentlyConsumed.length ? (
                <FrequencyTable rows={data.frequentlyConsumed} kind="consumed" />
              ) : (
                <EmptyState compact className="m-4" icon={TrendingUp} title="Nothing issued in this period" />
              )}
            </Section>
          </div>

          <Section title="No movement during the period" description="No purchase, issue, return, adjustment, move or write-off at all in the period." contentClassName="p-0 sm:p-0">
            {data.noMovement.length ? <IdleTable rows={data.noMovement} /> : <EmptyState compact className="m-4" icon={Ban} title="Every material moved at least once" />}
          </Section>
        </>
      )}
    </Page>
  );
}
