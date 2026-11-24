import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Boxes, CalendarRange, Search, Trash2, TrendingUp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatDate, formatMonth, formatNumber, formatPercent, round2 } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { UNUSUAL_MIN_UNITS, UNUSUAL_PRIOR_DAYS, UNUSUAL_RATIO, UNUSUAL_RECENT_DAYS, MIN_HISTORY_DAYS } from "@/features/analytics/forecasting/constants";
import { parseFilters, resolveWindow, type SearchParams } from "@/features/analytics/forecasting/params";
import { consumptionOutlook } from "@/features/analytics/forecasting/server/consumption";
import { filterOptions } from "@/features/analytics/forecasting/server/options";
import { ForecastFilters } from "@/features/analytics/forecasting/components/forecast-filters";
import { ConsumptionTable, UnusualList, WastageList } from "@/features/analytics/forecasting/components/consumption-table";
import { MonthlyUseChart } from "@/features/analytics/forecasting/components/charts";
import { MethodNote } from "@/features/analytics/forecasting/components/notes";
import { formatQty, plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Material consumption forecast" };

type Props = { searchParams: Promise<SearchParams> };

export default async function ConsumptionForecastPage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.forecasting.view)) return <NoAccess eyebrow="Analytics & Planning" title="Material consumption forecast" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  const window = resolveWindow(sp);
  const filters = parseFilters(sp);
  const [{ rows, months, totalItems }, options] = await Promise.all([consumptionOutlook(window, filters), filterOptions()]);

  const used = rows.filter((r) => r.consumed > 0 || r.last4Weeks > 0 || r.prev4Weeks > 0);
  const unusual = rows.filter((r) => r.unusual);
  const wasted = rows.filter((r) => r.wasted > 0).sort((a, b) => b.wastedValue - a.wastedValue);
  const shortages = rows.filter((r) => r.stockoutDate && (r.daysOfCover ?? Infinity) <= 30).sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0));
  const single = filters.item ? rows[0] : null;
  const last = months.at(-1);
  const monthValue = round2(months.slice(-1)[0]?.consumedValue ?? 0);
  const wastedValue = round2(wasted.reduce((s, r) => s + r.wastedValue, 0));
  const adjustments = months.reduce((s, m) => s + m.adjustmentsUp + m.adjustmentsDown, 0);
  const windowText = `${formatDate(fromDateInput(window.from))} to ${formatDate(fromDateInput(window.to))} (${window.days} days)`;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Material consumption"
        description="How fast each material is used, how that is changing and what the next 30 days look like. Use is stock assigned to projects less stock returned."
        actions={
          open("/inventory/movements") ? (
            <Button asChild variant="outline">
              <Link href="/inventory/movements">Stock movements</Link>
            </Button>
          ) : null
        }
      />
      <ForecastFilters materials={options.materials} categories={options.categories} projects={options.projects} window={window} />

      {totalItems === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No inventory items yet"
          description="Consumption shows once items are added and stock is assigned to projects."
          action={
            open("/inventory/items") ? (
              <Button asChild>
                <Link href="/inventory/items">Go to items</Link>
              </Button>
            ) : null
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No materials match these filters"
          description="Clear a filter to see consumption."
          action={
            open("/analytics/forecasting/consumption") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/forecasting/consumption">Clear filters</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Materials used in the window" icon={Activity} tone="brand" value={formatNumber(rows.filter((r) => r.consumed > 0).length)} hint={`Of ${plural(rows.length, "material")}`} />
            <StatCard
              label={last ? `Value used in ${formatMonth(fromDateInput(`${last.month}-01`))}` : "Value used this month"}
              icon={CalendarRange}
              tone="info"
              value={<Money value={monthValue} compact />}
              hint="This month so far, assigned less returned"
            />
            <StatCard label="Unusual changes" icon={TrendingUp} tone={unusual.length ? "warning" : "default"} value={formatNumber(unusual.length)} hint="Last 30 days against the 90 before" />
            <StatCard
              label="Wasted in the window"
              icon={Trash2}
              tone={wasted.length ? "danger" : "default"}
              value={<Money value={wastedValue} compact />}
              hint={wasted.length ? plural(wasted.length, "material") : "No wastage recorded"}
            />
          </StatGrid>

          <MethodNote>
            <p>
              <span className="font-medium text-foreground">How this is worked out.</span> Per day is the use in the history window ({windowText}) divided by its days; per week
              and per 30 days scale that rate. Change compares the last 28 days with the 28 before. Next 30 days is shown only for materials with enough history, and uses the
              forecast rate: the same use divided by the days from the material&apos;s first assignment in the window (at least {MIN_HISTORY_DAYS}), so for a
              material first used partway through the window it is higher than 30 × per day.
              {filters.project ? " With a project picked, every figure is that project's own use." : ""}
              {window.adjusted ? ` ${window.adjusted}` : ""}
            </p>
            <p>
              An unusual change is a daily rate over the last {UNUSUAL_RECENT_DAYS} days more than {formatPercent(UNUSUAL_RATIO)} above or below the rate over the{" "}
              {UNUSUAL_PRIOR_DAYS} days before, for materials recorded for all {UNUSUAL_RECENT_DAYS + UNUSUAL_PRIOR_DAYS} days that moved at least {UNUSUAL_MIN_UNITS} units in
              that time.
            </p>
          </MethodNote>

          <Section
            title={single ? `${single.name}: use per month` : "Value used per month"}
            description={
              single
                ? `Units assigned less units returned, last 12 months${filters.project ? ", on the picked project" : ""}.`
                : `Cost of stock assigned less stock returned, last 12 months${filters.project ? ", on the picked project" : ""}. A month with more returns than assignments shows below zero.`
            }
          >
            {months.some((m) => m.consumedQty !== 0 || m.consumedValue !== 0) ? (
              <MonthlyUseChart months={months} unit={single ? single.unit : null} />
            ) : (
              <EmptyState compact icon={Activity} title="No use recorded in the last 12 months" description="Assign stock to projects to start a consumption history." />
            )}
          </Section>

          <Section title="Consumption by material" description="Daily, weekly and 30-day averages over the history window, with the last 4 weeks against the 4 before.">
            {used.length ? (
              <ConsumptionTable rows={used} />
            ) : (
              <EmptyState compact icon={Boxes} title="No use recorded" description="None of these materials was assigned to a project in the window or the last 8 weeks." />
            )}
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Unusual increases and decreases">
              {unusual.length ? (
                <UnusualList rows={unusual} />
              ) : (
                <EmptyState compact icon={TrendingUp} title="No unusual changes" description="No material's recent use moved more than the rule allows, or there is too little history to judge." />
              )}
            </Section>
            <Section
              title="Potential shortages"
              description="Forecast materials that run out within 30 days at the recent rate."
              actions={
                <Button asChild variant="outline" size="sm">
                  <Link href="/analytics/forecasting">Demand forecast</Link>
                </Button>
              }
            >
              {shortages.length ? (
                <ul className="divide-y">
                  {shortages.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                      <Link href={`/inventory/items/${r.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatQty(r.available, r.unit)} left · runs out {formatDate(r.stockoutDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon={TriangleAlert} title="No shortages expected in 30 days" description="Materials without enough history are not forecast; the demand page lists stock alerts for them." />
              )}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="Wastage by material"
              description={
                filters.project
                  ? "Units written off in the window while in use on this project. Storage write-offs belong to no project and are left out."
                  : "Units written off in the window, from storage or while in use on a project."
              }
            >
              {wasted.length ? (
                <WastageList rows={wasted} />
              ) : (
                <EmptyState compact icon={Trash2} title="No wastage recorded in the window" description="Wastage recorded under Inventory shows here." />
              )}
            </Section>
            <Section title="Wastage and adjustments by month" description="Write-offs and manual stock corrections, last 12 months." contentClassName="p-0 sm:p-0">
              {wastedValue > 0 || adjustments > 0 || months.some((m) => m.wastageCount > 0) ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4 sm:pl-5">Month</TableHead>
                        <TableHead className="text-right">Wastage entries</TableHead>
                        <TableHead className="text-right">Value wasted</TableHead>
                        <TableHead className="text-right">Adjustments up</TableHead>
                        <TableHead className="pr-4 text-right sm:pr-5">Adjustments down</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...months].reverse().map((m) => (
                        <TableRow key={m.month}>
                          <TableCell className="pl-4 sm:pl-5">{formatMonth(fromDateInput(`${m.month}-01`))}</TableCell>
                          <TableCell className="tabular text-right">{m.wastageCount || "-"}</TableCell>
                          <TableCell className="text-right">{m.wastedValue ? <Money value={m.wastedValue} /> : "-"}</TableCell>
                          <TableCell className="tabular text-right">{m.adjustmentsUp || "-"}</TableCell>
                          <TableCell className="tabular pr-4 text-right sm:pr-5">{m.adjustmentsDown || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="p-4 sm:p-5">
                  <EmptyState compact icon={Trash2} title="No wastage or adjustments in 12 months" description="Write-offs and stock count corrections show here by month." />
                </div>
              )}
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}
