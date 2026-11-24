import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { Archive, Boxes, CalendarRange, PackagePlus, Search, TrendingUp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber, round2 } from "@/lib/format";
import { endOfDayIST, fromDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { MIN_HISTORY_DAYS, MIN_MOVEMENTS, METHOD_DEMAND, OVERSTOCK_DAYS, SEASONAL_MIN_MONTHS } from "@/features/analytics/forecasting/constants";
import { parseFilters, resolveWindow, type SearchParams } from "@/features/analytics/forecasting/params";
import { demandForecast } from "@/features/analytics/forecasting/server/demand";
import { seasonalPattern, shortageRisks } from "@/features/analytics/forecasting/server/demand-extras";
import { projectUseInWindow } from "@/features/analytics/forecasting/server/history";
import { filterOptions } from "@/features/analytics/forecasting/server/options";
import { ensureMonthSnapshot } from "@/features/analytics/forecasting/server/snapshots";
import { ForecastFilters } from "@/features/analytics/forecasting/components/forecast-filters";
import { DemandTable } from "@/features/analytics/forecasting/components/demand-table";
import { OverstockList, ProjectUseList, ShortageList } from "@/features/analytics/forecasting/components/demand-parts";
import { SeasonalChart } from "@/features/analytics/forecasting/components/charts";
import { MethodNote, NotRecorded } from "@/features/analytics/forecasting/components/notes";
import { SaveForecastButton } from "@/features/analytics/forecasting/components/save-forecast-button";
import { plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Inventory demand forecast" };

type Props = { searchParams: Promise<SearchParams> };

export default async function DemandForecastPage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const window = resolveWindow(sp);
  const filters = parseFilters(sp);
  // The month's standard forecast is stored once for Forecast vs actual, after the page is sent.
  after(() => ensureMonthSnapshot("material_demand"));

  const [{ rows, totalItems }, options] = await Promise.all([demandForecast(window, filters), filterOptions()]);
  const scopedIds = filters.item || filters.category || filters.project ? rows.map((r) => r.id) : null;
  const [shortages, byProject, seasonal] = await Promise.all([
    shortageRisks(rows),
    projectUseInWindow(fromDateInput(window.from), endOfDayIST(fromDateInput(window.to)), scopedIds),
    seasonalPattern(scopedIds),
  ]);

  const forecast = rows.filter((r) => r.status === "forecast");
  const overstock = rows.filter((r) => r.overstock);
  const expectedValue = round2(forecast.reduce((s, r) => s + (r.predicted?.[30] ?? 0) * r.unitPrice, 0));
  const overstockValue = round2(overstock.reduce((s, r) => s + r.value, 0));
  const windowText = `${formatDate(fromDateInput(window.from))} to ${formatDate(fromDateInput(window.to))} (${window.days} days)`;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Inventory demand forecast"
        description="Expected use of each material over the coming days, how long stock lasts and which materials run short or sit unused. Built only from recorded stock movements."
        actions={
          <>
            <SaveForecastButton />
            <Button asChild>
              <Link href="/analytics/forecasting/purchases">
                <PackagePlus /> Purchase requirements
              </Link>
            </Button>
          </>
        }
      />
      <ForecastFilters materials={options.materials} categories={options.categories} projects={options.projects} window={window} />

      {totalItems === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No inventory items yet"
          description="Forecasts start once items are added and stock is assigned to projects."
          action={
            <Button asChild>
              <Link href="/inventory/items">Go to items</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No materials match these filters"
          description={filters.project ? "This project has no stock movements recorded. Pick another project or clear the filter." : "Clear a filter to see more materials."}
          action={
            <Button asChild variant="outline">
              <Link href="/analytics/forecasting">Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Materials with a forecast"
              icon={TrendingUp}
              tone="brand"
              value={`${formatNumber(forecast.length)} of ${formatNumber(rows.length)}`}
              hint={rows.length - forecast.length ? `${plural(rows.length - forecast.length, "material")} without enough history` : "All have enough history"}
            />
            <StatCard
              label="Expected use, next 30 days"
              icon={CalendarRange}
              tone="info"
              value={<Money value={expectedValue} compact />}
              hint="At average cost, forecast materials only"
            />
            <StatCard
              label="At risk of shortage"
              icon={TriangleAlert}
              tone={shortages.length ? "danger" : "success"}
              value={formatNumber(shortages.length)}
              hint={shortages.length ? "Out, below minimum or running out" : "None at risk"}
            />
            <StatCard
              label="May be overstocked"
              icon={Archive}
              tone={overstock.length ? "warning" : "default"}
              value={formatNumber(overstock.length)}
              hint={overstock.length ? <><Money value={overstockValue} compact /> at cost</> : "None"}
            />
          </StatGrid>

          <MethodNote>
            <p>
              <span className="font-medium text-foreground">How this is worked out.</span> {METHOD_DEMAND} History window: {windowText}.
              {window.adjusted ? ` ${window.adjusted}` : ""}
            </p>
            <p>
              A material is forecast only with at least {MIN_MOVEMENTS} assignments or returns in the window and {MIN_HISTORY_DAYS} days since its first recorded
              movement; others show the reason instead of a number. A material first used partway through the window has its use spread over the days since
              that first use (at least {MIN_HISTORY_DAYS}), not over the whole window. Coverage and stockout dates count from today&apos;s available stock.
              Extra for 30 days is the use expected in the next 30 days less what is available. Issued to projects is stock in use on projects, less units
              wasted there.
              {filters.project
                ? " With a project picked, the list shows materials that project has used, and rates, use counts and history are that project's own. Coverage, stockout dates and extra needed still compare that one project's rate with the company's whole stock, which other projects draw on too."
                : ""}
            </p>
          </MethodNote>

          <Section title="Demand by material" description="Expected use for 7, 15, 30, 60 and 90 days ahead. Used in window can be shown from the table's view menu.">
            <DemandTable rows={rows} showProject={Boolean(filters.project)} />
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="At risk of shortage"
              description="The stock alerts from Inventory: out of stock, at or below the minimum, or running out within the lead time plus a week at the 90-day rate."
              actions={
                <Button asChild variant="outline" size="sm">
                  <Link href="/inventory/low-stock">Low stock</Link>
                </Button>
              }
            >
              {shortages.length ? (
                <ShortageList rows={shortages} />
              ) : (
                <EmptyState compact icon={TriangleAlert} title="No materials at risk" description="Nothing is out of stock, under its minimum or running out soon." />
              )}
            </Section>
            <Section title="May be overstocked" description={`Stock lasting more than ${OVERSTOCK_DAYS} days at the recent rate, or in stock with no use in the window.`}>
              {overstock.length ? (
                <OverstockList rows={overstock} />
              ) : (
                <EmptyState compact icon={Archive} title="Nothing looks overstocked" description="Every material in stock was used in the window and lasts under the threshold." />
              )}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Previous project requirements" description="Value of stock each project used in the window (assigned less returned).">
              {byProject.length ? (
                <ProjectUseList rows={byProject} />
              ) : (
                <EmptyState compact icon={Boxes} title="No stock used on projects in this window" description="Assignments to projects show here." />
              )}
            </Section>
            <Section title="What the forecast cannot see" description="These are not recorded in the ERP, so the forecast assumes none.">
              <div className="space-y-3">
                <NotRecorded title="Upcoming project requirements">Planned material lists for projects are not recorded. Only stock already assigned counts.</NotRecorded>
                <NotRecorded title="Pending purchase orders">Orders placed with suppliers are not recorded until the stock is purchased.</NotRecorded>
                <NotRecorded title="Expected incoming stock">Delivery dates from vendors are not recorded.</NotRecorded>
              </div>
            </Section>
          </div>

          <Section title="Seasonal pattern" description={`Average value used in each calendar month. Needs at least ${SEASONAL_MIN_MONTHS} months of recorded use.`}>
            {seasonal.enough ? (
              <SeasonalChart pattern={seasonal.pattern} />
            ) : (
              <EmptyState
                compact
                icon={CalendarRange}
                title="Not enough history for seasonal patterns"
                description={
                  seasonal.firstUse
                    ? `Stock was first assigned on ${formatDate(seasonal.firstUse)}, ${plural(seasonal.months, "month")} ago. A pattern shows once ${SEASONAL_MIN_MONTHS} months are recorded.`
                    : "No stock has been assigned to a project yet."
                }
              />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
