import type { Metadata } from "next";
import Link from "next/link";
import {
  Boxes,
  CalendarClock,
  ChartColumn,
  CircleAlert,
  FlaskConical,
  Gauge,
  Hourglass,
  Lightbulb,
  PackagePlus,
  TrendingUp,
  TriangleAlert,
  UserRoundX,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber, formatPercent } from "@/lib/format";
import { SPEND_TYPES } from "@/lib/project-cost-types";
import { requireUser } from "@/server/auth/session";
import { getAnalyticsDashboard } from "@/features/analytics/dashboard/queries";
import { RULES } from "@/features/analytics/dashboard/rules";
import { DetailsLink, Footnote, InsightCard, RuleList } from "@/features/analytics/dashboard/components/bits";
import { BarsChart, MonthChart, type ChartSeries } from "@/features/analytics/dashboard/components/charts";

export const metadata: Metadata = { title: "Analytics" };

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

const COST_COLORS: Record<string, string> = {
  material: "var(--chart-1)",
  labour: "var(--chart-2)",
  equipment: "var(--chart-3)",
  transport: "var(--chart-4)",
  other: "var(--chart-5)",
};

const COST_SERIES: ChartSeries[] = SPEND_TYPES.map((t) => ({ key: t.key, label: t.label, color: COST_COLORS[t.key], stack: "cost" }));

export default async function AnalyticsDashboardPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const data = await getAnalyticsDashboard({ isAdmin });
  const c = data.cards;

  const hasConsumption = data.months.some((m) => m.consumed > 0 || m.wasted > 0);
  const hasProcurement = data.months.some((m) => m.bought > 0);
  const opening = data.months.reduce((s, m) => s + m.opening, 0);
  const hasStock = data.ageing.some((b) => b.items > 0);
  const hasVelocity = data.velocity.some((b) => b.items > 0);
  const performance = data.performance.filter((p) => p.time !== null || p.budget !== null || p.tasks !== null);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Dashboard"
        description="Risks and trends across stock, projects, equipment and people, from what is recorded in the ERP. Open any card or chart for the details behind it."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/analytics/insights">
                <Lightbulb /> Management insights
              </Link>
            </Button>
            <Button asChild>
              <Link href="/analytics/scenarios/new">
                <FlaskConical /> New what-if scenario
              </Link>
            </Button>
          </>
        }
      />

      <StatGrid>
        <InsightCard
          href="/analytics/inventory/shortages"
          label="Inventory shortage risks"
          value={formatNumber(c.shortages.count)}
          icon={CircleAlert}
          tone={c.shortages.count > 0 ? "danger" : "success"}
          hint={c.shortages.count > 0 ? `${formatNumber(c.shortages.out)} out, ${formatNumber(c.shortages.belowMin)} below minimum, ${formatNumber(c.shortages.runsOut)} running out` : "No item at risk"}
        />
        <InsightCard
          href="/analytics/forecasting/purchases"
          label="Purchases for the next 30 days"
          value={plural(c.purchases.count, "item")}
          icon={PackagePlus}
          tone={c.purchases.count > 0 ? "warning" : "default"}
          hint={
            c.purchases.count > 0 ? (
              <>
                About <Money value={c.purchases.cost} compact /> at recent prices
                {c.purchases.unknownCost > 0 ? `, ${formatNumber(c.purchases.unknownCost)} without a price` : ""}
              </>
            ) : (
              "Nothing to order yet"
            )
          }
        />
        <InsightCard
          href="/analytics/forecasting/projects"
          label="Predicted cost overruns"
          value={plural(c.overruns.count, "project")}
          icon={TriangleAlert}
          tone={c.overruns.count > 0 ? "danger" : "default"}
          hint={
            c.overruns.count > 0 ? (
              <>
                <Money value={c.overruns.amount} compact /> above budget, by the forecast or already
              </>
            ) : c.overruns.budgeted > 0 ? (
              `${plural(c.overruns.rated, "open project")} forecast by spend rate${c.overruns.spendToDate ? `, ${formatNumber(c.overruns.spendToDate)} at spend to date` : ""}${c.overruns.noForecast ? `, ${formatNumber(c.overruns.noForecast)} without a forecast` : ""}`
            ) : (
              "No open project has a budget"
            )
          }
        />
        <InsightCard
          href="/analytics/projects/performance"
          label="Projects at risk of delay"
          value={plural(c.delays.count, "project")}
          icon={CalendarClock}
          tone={c.delays.count > 0 ? "warning" : "success"}
          hint={`${plural(c.delays.overdueTasks, "overdue task")}, ${formatNumber(c.delays.pastEnd)} past end date`}
        />
        <InsightCard
          href="/analytics/projects/budget?status=active"
          label="Budget used (active projects with a budget)"
          value={c.budget.usage === null ? "No budgets" : formatPercent(c.budget.usage)}
          icon={Gauge}
          tone={c.budget.usage !== null && c.budget.usage > 1 ? "danger" : c.budget.usage !== null && c.budget.usage > 0.85 ? "warning" : "info"}
          hint={
            c.budget.projects > 0 ? (
              <>
                <Money value={c.budget.spent} compact /> of <Money value={c.budget.budget} compact />, {plural(c.budget.projects, "project")}
                {c.budget.withoutBudget > 0 ? `; ${formatNumber(c.budget.withoutBudget)} without a budget left out` : ""}
              </>
            ) : (
              "No active project has a budget"
            )
          }
        />
        <InsightCard
          href="/analytics/forecasting/maintenance"
          label="Maintenance due in 30 days"
          value={plural(c.maintenance.due + c.maintenance.overdue, "asset")}
          icon={Wrench}
          tone={c.maintenance.overdue > 0 ? "danger" : c.maintenance.due > 0 ? "warning" : "default"}
          hint={
            c.maintenance.due + c.maintenance.overdue === 0
              ? "Nothing due"
              : c.maintenance.overdue > 0
                ? `${formatNumber(c.maintenance.overdue)} already past due`
                : "None past due"
          }
        />
        <InsightCard
          href="/analytics/forecasting/manpower"
          label="Manpower shortages"
          value={formatNumber(c.manpower.overAllocated + c.manpower.unstaffed)}
          icon={UserRoundX}
          tone={c.manpower.overAllocated + c.manpower.unstaffed > 0 ? "warning" : "success"}
          hint={`${plural(c.manpower.overAllocated, "person", "people")} over 100%, ${plural(c.manpower.unstaffed, "active project")} without a team`}
        />
        <InsightCard
          href="/inventory"
          label="Current inventory value"
          value={<Money value={c.inventory.value} />}
          icon={Boxes}
          tone="brand"
          hint={`Stock in storage at average cost, ${plural(c.inventory.items, "active item")}`}
          linkLabel="Inventory"
        />
      </StatGrid>

      <RuleList
        rules={[
          { label: "Shortage risks", text: RULES.shortages },
          { label: "Purchases needed", text: RULES.purchases },
          { label: "Predicted cost overruns", text: RULES.overruns },
          { label: "Projects at risk of delay", text: RULES.delays },
          { label: "Budget used", text: RULES.budget },
          { label: "Maintenance due", text: RULES.maintenance },
          { label: "Manpower shortages", text: RULES.manpower },
          { label: "Inventory value", text: RULES.inventory },
        ]}
      />

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        <Section title="Material consumption" description="Stock used on projects each month, at cost, with wastage beside it." actions={<DetailsLink href="/analytics/inventory/consumption" />}>
          {hasConsumption ? (
            <MonthChart
              title="Material consumption by month"
              data={data.months}
              series={[
                { key: "consumed", label: "Used on projects", color: "var(--chart-1)" },
                { key: "wasted", label: "Wasted", color: "var(--chart-5)" },
              ]}
            />
          ) : (
            <EmptyState icon={ChartColumn} compact title="No stock used in the last 12 months" description="Assign stock to a project and its use shows here." />
          )}
          <Footnote>{RULES.consumption}</Footnote>
        </Section>

        <Section title="Procurement" description="Stock bought each month, at cost before GST." actions={<DetailsLink href="/analytics/insights/procurement" />}>
          {hasProcurement ? (
            <MonthChart title="Stock bought by month, before GST" data={data.months} series={[{ key: "bought", label: "Stock bought, before GST", color: "var(--chart-3)" }]} />
          ) : (
            <EmptyState icon={PackagePlus} compact title="No stock bought in the last 12 months" description="Purchases recorded with Buy stock show here." />
          )}
          <Footnote>
            {RULES.procurement} Procurement analysis counts the bill amounts instead, GST included.
            {opening > 0 ? (
              <>
                {" "}
                Opening and imported stock in these months: <Money value={opening} />.
              </>
            ) : null}
          </Footnote>
        </Section>
      </div>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        <Section title="Budget vs actual" description="Open projects with the most spend: budget and spend to date." actions={<DetailsLink href="/analytics/projects/budget?status=planning,active,on_hold" />}>
          {data.budgetRows.length ? (
            <BarsChart
              title="Budget and spend per project"
              data={data.budgetRows}
              series={[
                { key: "budget", label: "Budget", color: "var(--chart-3)" },
                { key: "spent", label: "Spent", color: "var(--chart-1)" },
              ]}
            />
          ) : (
            <EmptyState icon={Gauge} compact title="No open project has a budget or spend yet" />
          )}
          <SalariesHiddenNote className="mt-3" />
        </Section>

        <Section title="Project-wise cost" description="Where each open project's spend went, by type of expense." actions={<DetailsLink href="/analytics/projects" />}>
          {data.projectCosts.length ? (
            <BarsChart title="Spend by type per project" data={data.projectCosts.map((p) => ({ ...p, label: p.name }))} series={COST_SERIES} />
          ) : (
            <EmptyState icon={ChartColumn} compact title="No spend on open projects yet" />
          )}
          <Footnote>Materials include stock issued to the project. Types follow the expense category, as on the project finance pages.</Footnote>
          <SalariesHiddenNote className="mt-2" />
        </Section>
      </div>

      <Section
        title="Project performance"
        description="Active projects: planned time gone by, budget spent and tasks done. A project whose spend or time runs well ahead of its tasks needs a look."
        actions={<DetailsLink href="/analytics/projects/performance" />}
      >
        {performance.length ? (
          <BarsChart
            title="Time, budget and tasks per active project"
            format="percent"
            labelWidth={140}
            reference={{ value: 1, label: "100%" }}
            data={performance}
            series={[
              { key: "time", label: "Time gone by", color: "var(--chart-4)" },
              { key: "budget", label: "Budget spent", color: "var(--chart-1)" },
              { key: "tasks", label: "Tasks done", color: "var(--chart-3)" },
            ]}
          />
        ) : (
          <EmptyState icon={TrendingUp} compact title="No active project with dates, a budget or tasks" description="Add start and end dates, a budget and tasks to a project to compare its progress." />
        )}
        <Footnote>{RULES.performance} A bar is missing when its record is (no dates, no budget or no tasks).</Footnote>
      </Section>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        <Section title="Inventory ageing" description="Value of stock in storage by how long it has been held." actions={<DetailsLink href="/analytics/inventory/ageing" />}>
          {hasStock ? (
            <BarsChart
              title="Stock value by age"
              data={data.ageing.map((b) => ({ label: b.label, value: b.value, note: plural(b.items, "item") }))}
              series={[{ key: "value", label: "Value on hand", color: "var(--chart-1)" }]}
              noteKey="note"
            />
          ) : (
            <EmptyState icon={Hourglass} compact title="No stock in storage" />
          )}
          <Footnote>{RULES.ageing}</Footnote>
        </Section>

        <Section title="Fast and slow moving" description="Value of stock on hand by how fast it is used." actions={<DetailsLink href="/analytics/inventory/velocity" />}>
          {hasVelocity ? (
            <BarsChart
              title="Stock value by movement speed"
              data={data.velocity.map((b) => ({ label: b.label, value: b.value, note: plural(b.items, "item") }))}
              series={[{ key: "value", label: "Value on hand", color: "var(--chart-2)" }]}
              noteKey="note"
            />
          ) : (
            <EmptyState icon={Gauge} compact title="No stock or use recorded" />
          )}
          <Footnote>{RULES.velocity}</Footnote>
        </Section>
      </div>
    </Page>
  );
}
