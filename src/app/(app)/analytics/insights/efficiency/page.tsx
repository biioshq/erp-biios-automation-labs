import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarClock, CircleAlert, Hammer, Layers, Recycle, Trash2, Users, Wrench } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber, formatPercent } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer, userCanOpen } from "@/features/analytics/viewer";
import { getEfficiencyInsights } from "@/features/analytics/insights/efficiency";
import { RULES } from "@/features/analytics/dashboard/rules";
import { DetailsLink, Footnote, InsightCard, NotRecorded } from "@/features/analytics/dashboard/components/bits";
import { MonthChart } from "@/features/analytics/dashboard/components/charts";
import { EquipmentTable, ItemUseTable, MaintenanceTable, PeopleTable, ProjectsTable } from "@/features/analytics/insights/components/tables";

export const metadata: Metadata = { title: "Operational efficiency" };

const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

function ShortageLine({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-4 py-2.5 text-sm hover:underline">
      <span>{label}</span>
      <span className={count > 0 ? "tabular font-semibold text-danger" : "tabular text-muted-foreground"}>{formatNumber(count)}</span>
    </Link>
  );
}

export default async function OperationalEfficiencyPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.insights)) return <NoAccess eyebrow="Analytics & Planning" title="Operational efficiency" />;
  const data = await getEfficiencyInsights(analyticsViewer(user));
  // A card or chart shows only when its page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const m = data.materials;
  const people = data.people;
  const stockAlerts = data.shortages.out + data.shortages.belowMin + data.shortages.runsOut;
  const shortages = stockAlerts + people.over.length + people.unstaffed.length;
  const useMonths = data.months.map((x) => ({ month: x.month, consumed: x.consumed, received: Math.round((x.bought + x.opening) * 100) / 100 }));
  const hasUse = useMonths.some((x) => x.consumed > 0 || x.received > 0);
  const hasWaste = data.months.some((x) => x.wasted > 0);
  const hasOverheads = data.overheads.months.some((x) => x.amount > 0);

  return (
    <Page>
      <PageHeader
        eyebrow="Management insights"
        title="Operational efficiency"
        description={`How materials, equipment and people are used, where work is late or short, and what is wasted. Figures cover the last 12 months (${data.windowLabel}) unless a section says otherwise.`}
      />

      <StatGrid>
        {open("/analytics/inventory/consumption") ? (
          <InsightCard
            href="/analytics/inventory/consumption"
            label="Material utilisation"
            value={m.ratio === null ? "Nothing received" : formatPercent(m.ratio)}
            icon={Layers}
            tone="info"
            hint={
              <>
                <Money value={m.consumed} compact /> used of <Money value={m.bought + m.opening} compact /> received
              </>
            }
          />
        ) : null}
        {open("/analytics/projects/resources") ? (
          <InsightCard
            href="/analytics/projects/resources"
            label="Equipment on projects"
            value={data.equipment.total ? `${formatNumber(data.equipment.onProjects)} of ${formatNumber(data.equipment.total)}` : "None recorded"}
            icon={Hammer}
            hint={data.equipment.total ? `${formatPercent(data.equipment.onProjects / data.equipment.total)} in use today` : "No asset is marked as equipment"}
          />
        ) : null}
        {open("/analytics/forecasting/manpower") ? (
          <InsightCard
            href="/analytics/forecasting/manpower"
            label="Manpower allocated"
            value={people.average === null ? "No people" : formatPercent(people.average)}
            icon={Users}
            tone={people.over.length ? "warning" : "default"}
            hint={`Average of ${plural(people.active, "person", "people")}, ${formatNumber(people.over.length)} over 100%`}
          />
        ) : null}
        {open("/analytics/projects/performance") ? (
          <InsightCard
            href="/analytics/projects/performance"
            label="Projects delayed or at risk"
            value={formatNumber(data.delays.projects.length)}
            icon={CalendarClock}
            tone={data.delays.projects.length ? "warning" : "success"}
            hint={`${plural(data.delays.overdueTasks, "overdue task")}, ${formatNumber(data.delays.pastEnd)} past end date`}
          />
        ) : null}
        {open("/analytics/inventory/shortages") ? (
          <InsightCard href="/analytics/inventory/shortages" label="Resource shortages" value={formatNumber(shortages)} icon={CircleAlert} tone={shortages ? "danger" : "success"} hint={`${plural(stockAlerts, "stock alert")}, ${plural(people.over.length + people.unstaffed.length, "staffing gap")}`} />
        ) : null}
        {open("/inventory/wastage") ? (
          <InsightCard href="/inventory/wastage" label="Stock wasted" value={<Money value={data.wastage.total} />} icon={Trash2} tone={data.wastage.total > 0 ? "danger" : "default"} hint="At cost, from storage and projects" linkLabel="Wastage" />
        ) : null}
        <StatCard label="Overheads, 12 months" value={<Money value={data.overheads.total} />} icon={Building2} hint={data.salariesHidden ? "Indirect expenses, salaries left out" : "Indirect company expenses"} />
        {open("/analytics/forecasting/maintenance") ? (
          <InsightCard href="/analytics/forecasting/maintenance" label="Maintenance due" value={plural(data.maintenance.length, "asset")} icon={Wrench} tone={data.maintenance.some((x) => x.overdue) ? "danger" : "default"} hint="Equipment due within 30 days or past due" />
        ) : null}
      </StatGrid>

      {open("/analytics/inventory/consumption") ? (
        <Section title="Material utilisation" description="Stock used on projects against stock received each month, at cost." actions={<DetailsLink href="/analytics/inventory/consumption">Consumption trends</DetailsLink>}>
          {hasUse ? (
            <MonthChart
              title="Stock used and received by month"
              data={useMonths}
              series={[
                { key: "consumed", label: "Used on projects", color: "var(--chart-1)" },
                { key: "received", label: "Received (bought, opening or imported)", color: "var(--chart-3)" },
              ]}
            />
          ) : (
            <EmptyState icon={Layers} compact title="No stock received or used in the last 12 months" />
          )}
          <Footnote>
            {RULES.consumption} Received is every stock entry: bought, opening and imported. Used can be more than received when older stock is used.
          </Footnote>
        </Section>
      ) : null}

      {open("/analytics/inventory") ? (
        <Section title="Utilisation by item" description="Received, used and wasted per item over the same 12 months, most used first." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/inventory">Stock movement</DetailsLink>}>
          {data.items.length ? <ItemUseTable rows={data.items} /> : <EmptyState icon={Layers} compact className="m-4" title="No stock movements in the last 12 months" />}
        </Section>
      ) : null}

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        {open("/analytics/forecasting/manpower") ? (
          <Section title="Manpower utilisation" description="Share of each person's time on current project work (active or on-hold projects that have started)." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/forecasting/manpower">Manpower</DetailsLink>}>
            {people.employees.length ? (
              <>
                <PeopleTable rows={people.employees} />
                <Footnote className="px-4 pb-4 sm:px-5">
                  {formatNumber(people.full)} at 100% or more, {formatNumber(people.unallocated)} on no current project. Hours worked are not recorded, so this is planned allocation, not time spent.
                </Footnote>
              </>
            ) : (
              <EmptyState icon={Users} compact className="m-4" title="No people recorded" description="Add employees and assign them to projects to see their allocation." />
            )}
          </Section>
        ) : null}
        <Section title="Equipment utilisation" description="Equipment in the asset register and the project each one is on today." contentClassName="p-0 sm:p-0">
          {data.equipment.rows.length ? (
            <EquipmentTable rows={data.equipment.rows} />
          ) : (
            <NotRecorded className="m-4" title="No equipment recorded" description="Add machinery, computers or vehicles to the asset register, or mark an asset as equipment, to track which ones are out on projects. Usage hours are not recorded." />
          )}
        </Section>
      </div>

      {open("/analytics/projects/performance") ? (
        <Section title="Project delays" description={RULES.delays} contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/projects/performance">Project performance</DetailsLink>}>
          {data.delays.projects.length ? (
            <ProjectsTable rows={data.delays.projects} />
          ) : (
            <EmptyState icon={CalendarClock} compact className="m-4" title="No active project is late" description="No overdue tasks and no end date has passed." />
          )}
          <SalariesHiddenNote className="px-4 pb-4 sm:px-5" />
        </Section>
      ) : null}

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        <Section title="Resource shortages" description="What is short now, across stock and people.">
          <div className="divide-y">
            <ShortageLine href="/analytics/inventory/shortages" label="Items out of stock" count={data.shortages.out} />
            <ShortageLine href="/analytics/inventory/shortages" label="Items at or below minimum" count={data.shortages.belowMin} />
            <ShortageLine href="/analytics/inventory/shortages" label="Items running out within lead time" count={data.shortages.runsOut} />
            <ShortageLine href="/analytics/forecasting/manpower" label="People allocated over 100%" count={people.over.length} />
            <ShortageLine href="/analytics/forecasting/manpower" label="Active projects with nobody assigned" count={people.unstaffed.length} />
          </div>
          {people.unstaffed.length ? (
            <Footnote>
              Without a team:{" "}
              {people.unstaffed.map((p, i) => (
                <span key={p.id}>
                  {i ? ", " : ""}
                  <Link href={`/finance/projects/${p.id}?tab=team`} className="underline underline-offset-2">
                    {p.name}
                  </Link>
                </span>
              ))}
              .
            </Footnote>
          ) : null}
        </Section>
        {open("/analytics/forecasting/maintenance") ? (
          <Section title="Maintenance due" description="Equipment due for a service within 30 days, or past due." contentClassName="p-0 sm:p-0" actions={<DetailsLink href="/analytics/forecasting/maintenance">Maintenance</DetailsLink>}>
            {data.maintenance.length ? <MaintenanceTable rows={data.maintenance} /> : <EmptyState icon={Wrench} compact className="m-4" title="No maintenance due" description={RULES.maintenance} />}
          </Section>
        ) : null}
      </div>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
        {open("/inventory/wastage") ? (
          <Section title="Stock wastage" description="Value of stock written off each month, at cost." actions={<DetailsLink href="/inventory/wastage">Wastage records</DetailsLink>}>
            {hasWaste ? (
              <>
                <MonthChart title="Wastage by month" data={data.months} series={[{ key: "wasted", label: "Wasted", color: "var(--chart-5)" }]} />
                <div className="mt-4 divide-y text-sm">
                  {data.wastage.byReason.map((r) => (
                    <div key={r.reason} className="flex items-center justify-between gap-4 py-2">
                      <span>
                        {r.label} <span className="text-xs text-muted-foreground">({plural(r.entries, "entry", "entries")})</span>
                      </span>
                      <Money value={r.value} className="font-medium" />
                    </div>
                  ))}
                </div>
                <Footnote>
                  From storage: <Money value={data.wastage.storage} />. From stock in use on projects: <Money value={data.wastage.project} />, already charged to those projects when it was issued.
                </Footnote>
              </>
            ) : (
              <EmptyState icon={Recycle} compact title="No wastage recorded in the last 12 months" />
            )}
          </Section>
        ) : null}
        {open("/finance/expenses/summary") ? (
          <Section title="Operational cost trend" description="Indirect expenses (overheads) each month: company costs not booked to a project." actions={<DetailsLink href="/finance/expenses/summary">Expense summary</DetailsLink>}>
            {hasOverheads ? (
              <>
                <MonthChart title="Overheads by month" data={data.overheads.months} series={[{ key: "amount", label: "Overheads", color: "var(--chart-4)" }]} />
                <div className="mt-4 divide-y text-sm">
                  {data.overheads.categories.slice(0, 6).map((c) => (
                    <div key={c.value} className="flex items-center justify-between gap-4 py-2">
                      <span className="min-w-0 truncate">{c.label}</span>
                      <Money value={c.amount} className="font-medium" />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState icon={Building2} compact title="No overheads in the last 12 months" />
            )}
            <Footnote>
              Categories count as indirect by their setting in Expenses (an expense on a project is always direct). Fixed-asset purchases, stock records and finance costs (loan
              interest, bank charges) are left out. Amounts are by bill date, so a prepaid bill counts in the month it was entered.
              {data.salariesHidden ? " Salaries are left out for your role." : ""}
            </Footnote>
          </Section>
        ) : null}
      </div>
    </Page>
  );
}
