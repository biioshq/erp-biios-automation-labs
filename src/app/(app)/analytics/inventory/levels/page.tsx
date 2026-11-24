import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveX, CircleAlert, PackageOpen, PackagePlus, ShoppingCart, TriangleAlert } from "lucide-react";
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
import { intParam } from "@/features/analytics/inventory/params";
import { LOW_USE_SHARE, getLevels } from "@/features/analytics/inventory/levels-queries";
import { ALERT_BUFFER_DAYS } from "@/server/analytics/core";
import { ParamSelect } from "@/features/analytics/inventory/components/controls";
import { NotRecorded, RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { BelowMinimumTable, CoverTable, ExcessTable, IdleStockTable, OverboughtTable, ReorderTable } from "@/features/analytics/inventory/components/levels-sections";

export const metadata: Metadata = { title: "Overstock and understock" };

const WINDOWS = [30, 60, 90, 180, 365] as const;
const COVERS = [60, 90, 120, 180, 270, 365] as const;

export default async function LevelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.inventory)) return <NoAccess eyebrow="Analytics & Planning" title="Overstock and understock" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  const windowDays = intParam(sp, "window", { fallback: 90, allowed: WINDOWS });
  const coverDays = intParam(sp, "cover", { fallback: 180, allowed: COVERS });
  const data = await getLevels(windowDays, coverDays);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Overstock and understock"
        description={`Stock held against how fast it was used in the last ${windowDays} days: too much, too little, and bought but not used.`}
        actions={
          <>
            {open("/inventory/low-stock") ? (
              <Button asChild variant="outline">
                <Link href="/inventory/low-stock">
                  <CircleAlert /> Low stock
                </Link>
              </Button>
            ) : null}
            {open("/analytics/inventory/shortages") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/inventory/shortages">
                  <TriangleAlert /> Shortage risk
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <ParamSelect
          name="window"
          value={String(windowDays)}
          fallback="90"
          label="Rate of use measured over"
          options={WINDOWS.map((d) => ({ value: String(d), label: `Use over the last ${d} days` }))}
        />
        <ParamSelect
          name="cover"
          value={String(coverDays)}
          fallback="180"
          label="Excess beyond"
          options={COVERS.map((d) => ({ value: String(d), label: `Excess beyond ${d} days of cover` }))}
        />
      </div>

      {data.itemCount === 0 ? (
        <EmptyState icon={PackageOpen} title="No inventory items yet" description="Add items with a minimum level and record purchases and issues to see their stock levels here." />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Excess stock"
              icon={ArchiveX}
              tone={data.excess.length ? "warning" : "success"}
              value={<Money value={data.excessValue} />}
              hint={plural(data.excess.length, "material", "materials")}
            />
            <StatCard
              label="Below minimum"
              icon={CircleAlert}
              tone={data.belowMinimum.length ? "danger" : "success"}
              value={data.belowMinimum.length}
              hint={`Of ${plural(data.withMinimum, "item", "items")} with a minimum set`}
            />
            <StatCard
              label="Insufficient cover"
              icon={TriangleAlert}
              tone={data.insufficient.length ? "danger" : "success"}
              value={data.insufficient.length}
              hint={`Run out within lead time plus ${ALERT_BUFFER_DAYS} days`}
            />
            <StatCard
              label="No recent consumption"
              icon={PackageOpen}
              tone="default"
              value={<Money value={data.idleValue} />}
              hint={plural(data.idle.length, "material in storage", "materials in storage")}
            />
          </StatGrid>

          <Section title="Excess stock" description={`More than ${coverDays} days of cover at the recent rate of use, or stock above the minimum that was not used in ${windowDays} days.`} contentClassName="p-0 sm:p-0">
            {data.excess.length ? (
              <ExcessTable rows={data.excess} windowDays={windowDays} />
            ) : (
              <EmptyState compact className="m-4" icon={ArchiveX} title="No excess stock by this rule" />
            )}
          </Section>

          <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
            <Section title="Below minimum" description="Available stock at or under the minimum level set on the item." contentClassName="p-0 sm:p-0">
              {data.belowMinimum.length ? (
                <BelowMinimumTable rows={data.belowMinimum} />
              ) : (
                <EmptyState compact className="m-4" icon={CircleAlert} title={data.withMinimum ? "Nothing below its minimum" : "No item has a minimum level set"} />
              )}
            </Section>
            <Section title="Below reorder level" description="Above the minimum, but at or under the minimum plus the use expected during the lead time." contentClassName="p-0 sm:p-0">
              <div className="space-y-3 p-4 sm:p-5">
                {data.noLeadTime ? (
                  <NotRecorded title={`Lead time not recorded on ${plural(data.noLeadTime, "item", "items")}`}>
                    A reorder level is not stored separately. It is worked out as the minimum plus the rate of use times the lead time. Without a lead time
                    it equals the minimum, so those items show under Below minimum instead. Set the lead time on an item to include it here.
                  </NotRecorded>
                ) : null}
                {data.belowReorder.length ? null : <p className="text-sm text-muted-foreground">No item is between its minimum and its reorder level.</p>}
              </div>
              {data.belowReorder.length ? <ReorderTable rows={data.belowReorder} /> : null}
            </Section>
          </div>

          <Section
            title="Insufficient cover"
            description={`Stock that runs out within its lead time plus ${ALERT_BUFFER_DAYS} days at the recent rate of use, the same rule as the low-stock alerts.`}
            contentClassName="p-0 sm:p-0"
          >
            {data.insufficient.length ? (
              <CoverTable rows={data.insufficient} />
            ) : (
              <EmptyState compact className="m-4" icon={TriangleAlert} title="Every material with recent use has enough cover" />
            )}
          </Section>

          <Section
            title="No recent consumption"
            description={`Stock in storage with nothing used in the last ${windowDays} days, largest value first.${
              data.recentlyAdded ? ` ${plural(data.recentlyAdded, "item", "items")} first recorded within these days ${data.recentlyAdded === 1 ? "is" : "are"} not judged yet.` : ""
            }`}
            contentClassName="p-0 sm:p-0"
          >
            {data.idle.length ? <IdleStockTable rows={data.idle} /> : <EmptyState compact className="m-4" icon={PackageOpen} title="Every material in storage was used recently" />}
          </Section>

          <Section
            title="Bought more than used"
            description={`Purchased in the last ${windowDays} days, with less than ${Math.round(LOW_USE_SHARE * 100)}% of that quantity used in the same days.`}
            contentClassName="p-0 sm:p-0"
          >
            {data.overbought.length ? (
              <OverboughtTable rows={data.overbought} />
            ) : (
              <EmptyState compact className="m-4" icon={ShoppingCart} title="No material was bought well beyond its use" />
            )}
          </Section>
          <RuleNote>
            Rates of use are stock issued to projects less stock returned, over the chosen window, and come from the same measure as the inventory
            alerts. Write-offs are not use.{" "}
            <Link href="/inventory/purchase" className="inline-flex items-center gap-1 underline underline-offset-2">
              <PackagePlus className="size-3" aria-hidden /> Purchase stock
            </Link>
          </RuleNote>
        </>
      )}
    </Page>
  );
}
