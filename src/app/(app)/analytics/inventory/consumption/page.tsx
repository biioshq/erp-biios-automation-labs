import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowLeftRight, CalendarRange, FolderKanban, Sigma, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCompactCurrency, formatPercent } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { choiceParam, parseRange } from "@/features/analytics/inventory/params";
import { GRANULARITIES, MIN_PERIODS, defaultGranularity, getConsumption, type Granularity } from "@/features/analytics/inventory/consumption-queries";
import { ParamToggle, RangeControl } from "@/features/analytics/inventory/components/controls";
import { MoneyBars } from "@/features/analytics/inventory/components/charts";
import { RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { MaterialComparisonTable, ProjectComparisonTable } from "@/features/analytics/inventory/components/consumption-sections";

export const metadata: Metadata = { title: "Consumption trends" };

const GRAIN_LABEL: Record<Granularity, { option: string; per: string }> = {
  day: { option: "Daily", per: "day" },
  week: { option: "Weekly", per: "week" },
  month: { option: "Monthly", per: "month" },
};

export default async function ConsumptionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp, 90);
  const fallback = defaultGranularity(range.days);
  const asked = choiceParam(sp, "by", GRANULARITIES, fallback);
  const data = await getConsumption(range, asked);
  // A range too long for the grouping asked for is shown in the next coarser one.
  const granularity = data.granularity;
  const per = GRAIN_LABEL[granularity].per;
  const nothing = data.materials.length === 0;
  const spikes = data.series.filter((p) => p.unusual).length;
  const summary = `Stock consumed by ${per}, issued less returned. ${data.series
    .filter((p) => p.net !== 0)
    .map((p) => `${p.label}: ${formatCompactCurrency(p.net)}`)
    .join("; ") || "None"}.`;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Consumption trends"
        description="Stock used by projects over time: issued less returned, by day, week or month, compared with the period just before."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/analytics/inventory">
                <ArrowLeftRight /> Movement analysis
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/analytics/forecasting/consumption">
                <Activity /> Consumption forecast
              </Link>
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <RangeControl from={range.from} to={range.to} isDefault={range.isDefault} defaultText="Last 90 days" />
        <ParamToggle
          name="by"
          value={granularity}
          fallback={fallback}
          label="Group by"
          options={GRANULARITIES.map((g) => ({ value: g, label: GRAIN_LABEL[g].option }))}
        />
      </div>

      {nothing ? (
        <EmptyState
          icon={Activity}
          title="No stock consumed in this period or the one before"
          description={`Nothing was issued to a project in ${range.label} or in the period before it (${data.previous.label}). Pick another range.`}
        />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Consumed this period"
              icon={Activity}
              tone="brand"
              value={<Money value={data.totals.current} />}
              // Shown as plain text, not a red or green badge: more use is neither good nor bad in itself.
              hint={
                data.totals.change === null
                  ? "Nothing consumed in the previous period to compare with"
                  : data.totals.change === 0
                    ? "Same as the previous period"
                    : `${data.totals.change > 0 ? "Up" : "Down"} ${formatPercent(Math.abs(data.totals.change))} against the previous period`
              }
            />
            <StatCard label="Previous period" icon={CalendarRange} tone="default" value={<Money value={data.totals.previous} />} hint={data.previous.label} />
            <StatCard label={`Average a ${per}`} icon={Sigma} tone="info" value={<Money value={data.average} />} hint={plural(data.series.length, per, `${per}s`)} />
            <StatCard
              label="Unusual patterns"
              icon={TriangleAlert}
              tone={data.unusualMaterials.length || spikes ? "warning" : "success"}
              value={data.unusualMaterials.length}
              hint={data.enoughPeriods ? `Materials; ${plural(spikes, `spike ${per}`, `spike ${per}s`)}` : "Materials changed sharply"}
            />
          </StatGrid>

          <Section
            title={`${GRAIN_LABEL[granularity].option} consumption`}
            description={`Value of stock issued less returned each ${per}, ${range.label}.${data.enoughPeriods ? " Bars above twice the average are marked." : ""}${
              data.coarsenedFrom ? ` The range is too long to show by ${GRAIN_LABEL[data.coarsenedFrom].per}, so it is shown by ${per}.` : ""
            }`}
          >
            <MoneyBars
              data={data.series.map((p) => ({ label: p.label, net: p.net, unusual: p.unusual }))}
              labelKey="label"
              series={[{ key: "net", label: "Consumed (issued less returned)", color: "var(--chart-1)" }]}
              highlightKey="unusual"
              summary={summary}
            />
          </Section>

          <Section
            title="Unusual patterns"
            description="Materials whose use changed sharply against the previous period of the same length."
            contentClassName={data.unusualMaterials.length ? "p-0 sm:p-0" : undefined}
          >
            {data.unusualMaterials.length ? (
              <MaterialComparisonTable rows={data.unusualMaterials} />
            ) : (
              <EmptyState compact icon={TriangleAlert} title="No sharp change in any material" description="Every material used in both periods stayed between half and double its earlier use." />
            )}
          </Section>
          <RuleNote className="-mt-2">
            The rules: a material is unusual when its use this period is at least double, or at most half, its use in the previous period ({data.previous.label}),
            or stopped altogether. A {per} is marked on the chart when its consumption is more than twice the average {per} of the range; that needs at
            least {MIN_PERIODS} {per}s in the range. Materials used now and not before are listed below as new, not as unusual.
          </RuleNote>

          <Section title="Material-wise" description="Units consumed of each material, this period against the previous one." contentClassName="p-0 sm:p-0">
            <MaterialComparisonTable rows={data.materials} />
          </Section>

          <Section title="Project-wise" description="Value of stock each project consumed (issued less returned or moved on to another project), this period against the previous one." contentClassName="p-0 sm:p-0">
            {data.projects.length ? (
              <ProjectComparisonTable rows={data.projects} />
            ) : (
              <EmptyState compact className="m-4" icon={FolderKanban} title="No project consumed stock in these periods" />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
