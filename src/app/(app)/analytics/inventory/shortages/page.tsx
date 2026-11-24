import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, FolderKanban, LineChart, PackageX, ShieldCheck, Timer } from "lucide-react";
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
import { ALERT_BUFFER_DAYS } from "@/server/analytics/core";
import { intParam } from "@/features/analytics/inventory/params";
import { getShortages, suggestedOrderValue } from "@/features/analytics/inventory/shortage-queries";
import { ParamSelect } from "@/features/analytics/inventory/components/controls";
import { NotRecorded, RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { AffectedProjectsTable, ShortageTable } from "@/features/analytics/inventory/components/shortage-sections";

export const metadata: Metadata = { title: "Shortage risk" };

const WINDOWS = [30, 60, 90, 180] as const;
const HORIZONS = [30, 60, 90, 180] as const;

export default async function ShortagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.inventory)) return <NoAccess eyebrow="Analytics & Planning" title="Shortage risk" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  const windowDays = intParam(sp, "window", { fallback: 90, allowed: WINDOWS });
  const horizon = intParam(sp, "horizon", { fallback: 60, allowed: HORIZONS });
  const data = await getShortages(windowDays, horizon);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Shortage risk"
        description={`Materials likely to run out at the rate they were used in the last ${windowDays} days, when, and which projects use them.`}
        actions={
          <>
            {open("/analytics/forecasting/purchases") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/forecasting/purchases">
                  <LineChart /> Purchase requirements
                </Link>
              </Button>
            ) : null}
            {open("/inventory/low-stock") ? (
              <Button asChild variant="outline">
                <Link href="/inventory/low-stock">
                  <CircleAlert /> Low stock
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <ParamSelect name="window" value={String(windowDays)} fallback="90" label="Rate of use measured over" options={WINDOWS.map((d) => ({ value: String(d), label: `Use over the last ${d} days` }))} />
        <ParamSelect name="horizon" value={String(horizon)} fallback="60" label="Watch list horizon" options={HORIZONS.map((d) => ({ value: String(d), label: `Watch items running out within ${d} days` }))} />
      </div>

      {data.itemCount === 0 ? (
        <EmptyState icon={PackageX} title="No inventory items yet" description="Add items and record their use to see which ones may run out." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Out of stock" icon={PackageX} tone={data.out ? "danger" : "success"} value={data.out} hint="Needed, with nothing available" />
            <StatCard label="At or below minimum" icon={CircleAlert} tone={data.belowMin ? "warning" : "success"} value={data.belowMin} hint="Minimum level set on the item" />
            <StatCard label="Running out soon" icon={Timer} tone={data.runsOut ? "warning" : "success"} value={data.runsOut} hint={`Within lead time plus ${ALERT_BUFFER_DAYS} days`} />
            <StatCard
              label="Projects potentially affected"
              icon={FolderKanban}
              tone={data.affectedProjects.length ? "warning" : "default"}
              value={data.affectedProjects.length}
              hint={
                data.atRisk.length ? (
                  <>
                    Suggested orders cost about <Money value={suggestedOrderValue(data.atRisk)} /> at last purchase prices
                  </>
                ) : (
                  "Nothing at risk"
                )
              }
            />
          </StatGrid>

          <NotRecorded title="Purchase orders, expected deliveries and supplier delays are not recorded">
            The ERP records stock when it arrives, not when it is ordered, so pending orders, their expected delivery dates and supplier delays cannot be
            shown. Stockout dates below assume nothing new arrives. Lead times come from each item, where set.
          </NotRecorded>

          <Section
            title="At risk now"
            description={`Out of stock, at or below the minimum, or running out within the item's lead time plus ${ALERT_BUFFER_DAYS} days. The same rule as the low-stock alerts.`}
            contentClassName={data.atRisk.length ? "p-0 sm:p-0" : undefined}
          >
            {data.atRisk.length ? (
              <ShortageTable rows={data.atRisk} withSuggestion />
            ) : (
              <EmptyState compact icon={ShieldCheck} title="No material is at risk" description="Nothing is out, below its minimum, or running out within its lead time." />
            )}
          </Section>

          <Section
            title={`Watch list: runs out within ${horizon} days`}
            description="Not at risk yet, but at the recent rate of use these run out within the horizon."
            contentClassName={data.watch.length ? "p-0 sm:p-0" : undefined}
          >
            {data.watch.length ? (
              <ShortageTable rows={data.watch} />
            ) : (
              <EmptyState compact icon={Timer} title={`Nothing else runs out within ${horizon} days`} />
            )}
          </Section>

          <Section title="Projects potentially affected" description={`Projects that consumed a material at risk in the last ${windowDays} days.`} contentClassName={data.affectedProjects.length ? "p-0 sm:p-0" : undefined}>
            {data.affectedProjects.length ? (
              <AffectedProjectsTable rows={data.affectedProjects} />
            ) : (
              <EmptyState compact icon={FolderKanban} title="No project used a material at risk recently" />
            )}
          </Section>
          <RuleNote>
            Coverage is units in storage divided by the daily rate of use (issued less returned over the window). {plural(data.itemsWithRate, "item has", "items have")} a
            rate; items without recorded use have no stockout date, rather than a guessed one. Suggested orders cover the lead time plus{" "}
            {ALERT_BUFFER_DAYS} days of use and restore the minimum.
          </RuleNote>
        </>
      )}
    </Page>
  );
}
