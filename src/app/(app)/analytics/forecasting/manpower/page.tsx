import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, IndianRupee, UserRoundCheck, UserRoundX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMonth, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { MANPOWER_MONTHS } from "@/features/analytics/forecasting/constants";
import { manpowerOutlook } from "@/features/analytics/forecasting/server/manpower";
import { PeopleTable } from "@/features/analytics/forecasting/components/people-table";
import { ManpowerChart } from "@/features/analytics/forecasting/components/charts";
import { MethodNote, NotRecorded } from "@/features/analytics/forecasting/components/notes";
import { plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Manpower requirement forecast" };

const fte = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const monthName = (m: string) => formatMonth(fromDateInput(`${m}-01`));

export default async function ManpowerForecastPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.forecasting.view)) return <NoAccess eyebrow="Analytics & Planning" title="Manpower requirement forecast" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  // Pay figures are worked out only for people who see salaries, so they never reach anyone else's page.
  const seesSalaries = can(user, ANALYTICS.salaries);
  const data = await manpowerOutlook({ includeSalaries: seesSalaries });

  const header = (
    <PageHeader
      eyebrow="Analytics & Planning"
      title="Manpower requirement"
      description="Who is allocated to which projects now and on work that has not started, where people are stretched past full time and when."
      actions={
        open("/finance/employees") ? (
          <Button asChild variant="outline">
            <Link href="/finance/employees">Employees</Link>
          </Button>
        ) : null
      }
    />
  );

  if (data.people.length === 0) {
    return (
      <Page>
        {header}
        <EmptyState
          icon={Users}
          title="No employees recorded"
          description="Add employees and put them on project teams with a share of their time to see manpower demand."
          action={
            open("/finance/employees") ? (
              <Button asChild>
                <Link href="/finance/employees">Go to employees</Link>
              </Button>
            ) : null
          }
        />
      </Page>
    );
  }

  const active = data.people.filter((p) => p.status === "active");
  const over = data.people.filter((p) => p.peak > 100);
  const spare = active.filter((p) => p.peak < 100);
  const spareFte = spare.reduce((s, p) => s + (100 - p.peak), 0) / 100;
  const tightMonths = data.months.filter((m) => m.overPeople > 0 || m.demandFte > m.headcount);

  return (
    <Page>
      {header}
      <StatGrid>
        <StatCard label="Active employees" icon={Users} tone="default" value={formatNumber(active.length)} hint={data.onLeave ? `${formatNumber(data.onLeave)} on leave` : "None on leave"} />
        <StatCard label="Over-allocated" icon={UserRoundX} tone={over.length ? "danger" : "success"} value={formatNumber(over.length)} hint="Above 100% in some month ahead" />
        <StatCard label="Spare capacity" icon={UserRoundCheck} tone="info" value={`${fte(spareFte)} FTE`} hint={`Across ${plural(spare.length, "person", "people")} under 100% at their busiest`} />
        {seesSalaries && data.excessMonthlyCost !== undefined ? (
          <StatCard
            label="Extra labour cost a month"
            icon={IndianRupee}
            tone={data.excessMonthlyCost > 0 ? "warning" : "default"}
            value={<Money value={data.excessMonthlyCost} compact />}
            hint="Over-allocation covered at the same pay"
          />
        ) : (
          <StatCard label="Months with a shortage" icon={CalendarRange} tone={tightMonths.length ? "warning" : "success"} value={formatNumber(tightMonths.length)} hint={`Of the next ${MANPOWER_MONTHS}`} />
        )}
      </StatGrid>

      <MethodNote>
        <p>
          <span className="font-medium text-foreground">How this is worked out.</span> Demand is the share of time each person is given on project teams. Current work is on
          active or on-hold projects that have started; upcoming work is on projects still in planning or starting later. A membership counts from its start to its end date (the
          project&apos;s dates when the membership has none; an open project past its planned end counts as still running). Load is read at the busiest
          point of each month, so work that ends before other work starts is not added together, and a membership ending on the day another starts is
          a handoff. FTE means
          full-time equivalents: 100% of one person is 1 FTE. People on leave are left out of headcount and of the demand set against it.
        </p>
        {seesSalaries ? (
          <p>Extra labour cost is the allocation above 100% at each person&apos;s busiest month, priced at that person&apos;s monthly pay. Only people who can see salaries see it.</p>
        ) : null}
        {data.undated ? <p>{plural(data.undated, "upcoming membership")} on projects without a start date {data.undated === 1 ? "is" : "are"} left out of the month view.</p> : null}
      </MethodNote>
      <NotRecorded title="Role requirements per project">How many people of each role a project needs is not recorded. Demand here is only the allocations already made, so a project short of people it has not staffed yet does not show.</NotRecorded>

      <Section title={`Demand by month, next ${MANPOWER_MONTHS} months`} description="Allocated FTE against active employees. A month where allocation exceeds headcount, or anyone is above 100%, may need more people.">
        <ManpowerChart months={data.months} />
        {tightMonths.length ? (
          <ul className="mt-4 space-y-1 text-sm">
            {tightMonths.map((m) => (
              <li key={m.month}>
                <span className="font-medium">{monthName(m.month)}</span>
                <span className="text-muted-foreground">
                  : {fte(m.demandFte)} FTE allocated for {m.headcount} active employees
                  {m.overPeople ? `, ${plural(m.overPeople, "person", "people")} above 100%` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No month ahead has allocation beyond the people available.</p>
        )}
      </Section>

      <Section title="People" description="Allocation now, on upcoming work and in the busiest month ahead.">
        <PeopleTable rows={data.people} showCost={seesSalaries} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By department" description="Active employees only. Spare is headcount less the busiest month's allocation; below zero is a shortage." contentClassName="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 sm:pl-5">Department</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="text-right">Now (FTE)</TableHead>
                  <TableHead className="text-right">Upcoming (FTE)</TableHead>
                  <TableHead className="text-right">Busiest month (FTE)</TableHead>
                  <TableHead className="text-right">Spare (FTE)</TableHead>
                  <TableHead className="pr-4 text-right sm:pr-5">Over 100%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.departments.map((d) => (
                  <TableRow key={d.department}>
                    <TableCell className="pl-4 font-medium sm:pl-5">{d.label}</TableCell>
                    <TableCell className="tabular text-right">{d.headcount}</TableCell>
                    <TableCell className="tabular text-right">{fte(d.currentFte)}</TableCell>
                    <TableCell className="tabular text-right">{fte(d.upcomingFte)}</TableCell>
                    <TableCell className="tabular text-right">{fte(d.peakFte)}</TableCell>
                    <TableCell className={cn("tabular text-right", d.spareFte < 0 && "font-medium text-danger")}>{fte(d.spareFte)}</TableCell>
                    <TableCell className={cn("tabular pr-4 text-right sm:pr-5", d.overAllocated > 0 && "text-danger")}>{d.overAllocated || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
        <Section title="By role" description="Roles as entered on project teams." contentClassName="p-0">
          {data.roles.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4 sm:pl-5">Role</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Now (FTE)</TableHead>
                    <TableHead className="text-right">Upcoming (FTE)</TableHead>
                    <TableHead className="pr-4 text-right sm:pr-5">Projects</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.roles.map((r) => (
                    <TableRow key={r.role}>
                      <TableCell className="pl-4 font-medium sm:pl-5">{r.role}</TableCell>
                      <TableCell className="tabular text-right">{r.people}</TableCell>
                      <TableCell className="tabular text-right">{fte(r.currentFte)}</TableCell>
                      <TableCell className="tabular text-right">{fte(r.upcomingFte)}</TableCell>
                      <TableCell className="tabular pr-4 text-right sm:pr-5">{r.projects}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState compact icon={Users} title="No one is on a project team" description="Add people to project teams from each project's Team tab." />
            </div>
          )}
        </Section>
      </div>

      <Section title="Project manpower" description="Open projects with their team size and when they run.">
        {data.projects.length ? (
          <ul className="divide-y">
            {data.projects.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/finance/projects/${p.id}?tab=team`} className="flex min-w-0 items-center gap-3">
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium hover:underline">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.startDate ? formatDate(p.startDate) : "No start date"} to {p.endDate ? formatDate(p.endDate) : "no end date"}
                      {p.roles.length ? ` · ${p.roles.join(", ")}` : ""}
                    </span>
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="tabular text-muted-foreground">
                    {p.members ? `${plural(p.members, "person", "people")}, ${fte(p.fte)} FTE` : "No team yet"}
                  </span>
                  <ProjectStatusBadge status={p.status} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={Users} title="No open projects" description="Projects in planning, active or on hold show here with their teams." />
        )}
      </Section>
    </Page>
  );
}
