import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Boxes, ChartColumn, FolderKanban, History, PackageCheck, Scale, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { financialYearIST } from "@/lib/dates";
import { formatCompactCurrency, formatNumber, round2 } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { idParam, parseRange, rangeQuery, withParams } from "@/features/analytics/inventory/params";
import { getMovementAnalysis } from "@/features/analytics/inventory/movement-queries";
import { RangeControl } from "@/features/analytics/inventory/components/controls";
import { MoneyBars } from "@/features/analytics/inventory/components/charts";
import { NotRecorded, RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import {
  DepartmentWastageTable,
  HistoryTable,
  MaterialMovementTable,
  ProjectConsumptionTable,
  YearFlowTable,
} from "@/features/analytics/inventory/components/movement-sections";

export const metadata: Metadata = { title: "Stock movement analysis" };

const MONTH_SERIES = [
  { key: "received", label: "Received", color: "var(--chart-3)" },
  { key: "issued", label: "Issued", color: "var(--chart-1)" },
  { key: "returned", label: "Returned", color: "var(--chart-4)" },
  { key: "wasted", label: "Wasted", color: "var(--chart-5)" },
];

/** "2026-11" to "Nov 26" */
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export default async function StockMovementPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp, "fy");
  const historyId = idParam(sp, "item");
  const data = await getMovementAnalysis(range, historyId);
  const t = data.totals;
  const keep = rangeQuery(range);
  const wasted = round2(t.wastedStorage.value + t.wastedProject.value);
  const monthly = data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const monthlySummary = `Stock movement value by month. ${monthly
    .map((m) => `${m.label}: received ${formatCompactCurrency(m.received)}, issued ${formatCompactCurrency(m.issued)}, returned ${formatCompactCurrency(m.returned)}, wasted ${formatCompactCurrency(m.wasted)}`)
    .join("; ")}.`;

  // Oldest year first on the chart; the table lists the latest first.
  const yearly = [...data.yearly].reverse().map(({ label, received, issued, returned, wasted }) => ({ label, received, issued, returned, wasted }));
  const yearlySummary = `Stock movement value by financial year. ${yearly
    .map((y) => `${y.label}: received ${formatCompactCurrency(y.received)}, issued ${formatCompactCurrency(y.issued)}, returned ${formatCompactCurrency(y.returned)}, wasted ${formatCompactCurrency(y.wasted)}`)
    .join("; ")}.`;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Stock movement analysis"
        description="What the store received, issued to projects, got back and wrote off in the period, from the inventory ledger. Values are the cost recorded on each movement."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/inventory/movements">
                <History /> Movement log
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/analytics/inventory/consumption">
                <ChartColumn /> Consumption trends
              </Link>
            </Button>
          </>
        }
      />
      <RangeControl from={range.from} to={range.to} isDefault={range.isDefault} defaultText="This financial year to date" />

      {data.count === 0 && !data.history ? (
        <EmptyState
          icon={Boxes}
          title="No stock movements in this range"
          description="Nothing was purchased, issued, returned, adjusted, moved or wasted between these dates. Pick a wider range."
          action={
            <Button asChild variant="outline">
              <Link href="/inventory/purchase">Purchase stock</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Received (purchases)"
              icon={ArrowDownToLine}
              tone="success"
              value={<Money value={t.received.value} />}
              hint={
                t.opening.count ? (
                  <>
                    {plural(t.received.count, "purchase", "purchases")}; <Money value={t.opening.value} /> of opening stock entered as already on hand is not counted
                  </>
                ) : (
                  plural(t.received.count, "purchase", "purchases")
                )
              }
            />
            <StatCard
              label="Issued to projects"
              icon={ArrowUpFromLine}
              tone="brand"
              value={<Money value={t.issued.value} />}
              hint={
                t.moved.count ? (
                  <>
                    {plural(t.issued.count, "issue", "issues")}, <Money value={t.moved.value} /> of it moved between projects
                  </>
                ) : (
                  plural(t.issued.count, "issue", "issues")
                )
              }
            />
            <StatCard label="Returned to storage" icon={Undo2} tone="info" value={<Money value={t.returned.value} />} hint={plural(t.returned.count, "return", "returns")} />
            <StatCard
              label="Net consumed by projects"
              icon={PackageCheck}
              tone="default"
              value={<Money value={t.netIssued} />}
              hint="Issued minus returned"
            />
            <StatCard
              label="Wasted"
              icon={Trash2}
              tone={wasted > 0 ? "danger" : "default"}
              value={<Money value={wasted} />}
              hint={
                <>
                  <Money value={t.wastedStorage.value} /> in storage, <Money value={t.wastedProject.value} /> on site
                </>
              }
            />
            <StatCard
              label="Adjustments"
              icon={Scale}
              tone="warning"
              value={
                <span>
                  +<Money value={t.adjustedUp.value} /> / -<Money value={t.adjustedDown.value} />
                </span>
              }
              hint={`${plural(t.adjustedUp.count + t.adjustedDown.count, "count correction", "count corrections")}, up and down`}
            />
            <StatCard label="Location moves" icon={ArrowLeftRight} tone="default" value={formatNumber(t.relocations.count)} hint="Items moved to another storage place" />
            <StatCard label="Projects supplied" icon={FolderKanban} tone="default" value={formatNumber(data.projects.length)} hint={plural(data.materials.length, "material moved", "materials moved")} />
          </StatGrid>
          <RuleNote className="-mt-2">
            A move of stock from one project to another is recorded as a return from the first and an issue to the second, so it shows in both
            figures and nets to zero in consumption. Units are only added up per material below, because materials are counted in different units.
          </RuleNote>

          {data.history ? (
            <div id="movement-history" className="scroll-mt-20">
              <Section
                title={`Movement history: ${data.history.item.name}`}
                description={`Every movement of ${data.history.item.sku}, ${range.label}, newest first.`}
                actions={
                  <>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/inventory/items/${data.history.item.id}`}>Open item</Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/analytics/inventory${withParams(keep)}`} scroll={false}>
                        <X /> Close
                      </Link>
                    </Button>
                  </>
                }
                contentClassName="p-0 sm:p-0"
              >
                <HistoryTable rows={data.history.rows} unit={data.history.item.unit} />
              </Section>
            </div>
          ) : null}

          <Section
            title="Month by month"
            description={`Value received, issued, returned and wasted each month, ${range.label}.${data.monthlyTrimmed ? " Only the latest 36 months are shown." : ""}`}
          >
            <MoneyBars data={monthly} labelKey="label" series={MONTH_SERIES} summary={monthlySummary} />
          </Section>

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <Section title="Project-wise consumption" description="Stock issued to each project in the range, less what came back." contentClassName="p-0 sm:p-0">
              {data.projects.length ? (
                <ProjectConsumptionTable rows={data.projects} />
              ) : (
                <EmptyState compact className="m-4" icon={FolderKanban} title="No stock issued to projects in this range" />
              )}
            </Section>
            <Section title="Department-wise" description="Who stock goes to, by department.">
              <div className="space-y-4">
                <NotRecorded title="Department is not recorded on stock issues">
                  Stock is issued to projects, not departments, so consumption by department cannot be shown. Write-offs do record a department, listed below.
                </NotRecorded>
                {data.departments.length ? (
                  <div className="-mx-4 sm:-mx-5">
                    <DepartmentWastageTable rows={data.departments} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No stock was written off in this range.</p>
                )}
              </div>
            </Section>
          </div>

          <Section
            title="Material-wise movements"
            description="Units of each material that moved in the range. Open History for its movements one by one."
            contentClassName="p-0 sm:p-0"
          >
            {data.materials.length ? (
              <MaterialMovementTable rows={data.materials} historyHref={(id) => `/analytics/inventory${withParams(keep, { item: id })}`} />
            ) : (
              <EmptyState compact className="m-4" icon={Boxes} title="No materials moved in this range" />
            )}
          </Section>

          <Section title="Year by year" description="Value received, issued, returned and wasted in each financial year (April to March), over every movement recorded. Not limited by the date range." contentClassName="p-0 sm:p-0">
            {data.yearly.length ? (
              <>
                <div className="p-4 sm:p-5">
                  <MoneyBars data={yearly} labelKey="label" series={MONTH_SERIES} summary={yearlySummary} />
                </div>
                <YearFlowTable rows={data.yearly} current={financialYearIST().label} />
              </>
            ) : (
              <EmptyState compact className="m-4" title="No movements recorded yet" />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
