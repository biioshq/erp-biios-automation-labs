import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CircleCheck, FolderKanban, ListChecks, Scale, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatPercent } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { statusesParam } from "@/features/analytics/projects/model";
import { loadProjectCosts } from "@/features/analytics/projects/queries";
import { getPerformance } from "@/features/analytics/projects/performance-queries";
import { NotRecorded, RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { MIN_PROJECT_DAYS } from "@/features/analytics/project-forecast";
import { OverdueTable, PerformanceTable } from "@/features/analytics/projects/components/performance-sections";
import { ProjectStatusSelect } from "@/features/analytics/projects/components/project-filter";

export const metadata: Metadata = { title: "Project performance" };

export default async function PerformancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const statuses = statusesParam(await searchParams);
  const { rows: costs, total, salariesHidden } = await loadProjectCosts(statuses);
  const { rows, overdue, noProjectTasks } = await getPerformance(costs);
  const tasks = rows.reduce((s, r) => ({ total: s.total + r.tasks.total, completed: s.completed + r.tasks.completed }), { total: 0, completed: 0 });
  const behind = rows.filter(
    (r) => r.tasks.overdue > 0 || (r.latestOpenDue !== null && r.project.endDate !== null && r.latestOpenDue > r.project.endDate),
  );
  const costBehind = rows.filter((r) => r.costPerformance !== null && r.costPerformance < 1);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Project performance"
        description="Progress from each project's tasks, planned against expected and actual completion, cost performance, the people on it and the activities running late."
        actions={
          <>
            <ProjectStatusSelect statuses={statuses} />
            <Button asChild variant="outline">
              <Link href="/tasks/all">
                <ListChecks /> All tasks
              </Link>
            </Button>
          </>
        }
      />

      {total === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Create a project and add tasks to it to track its progress here." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title="No projects with this status" description="Pick another status to see those projects." />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Tasks completed"
              icon={CircleCheck}
              tone="success"
              value={tasks.total ? formatPercent(tasks.completed / tasks.total) : "No tasks"}
              hint={`${tasks.completed} of ${plural(tasks.total, "task", "tasks")}, cancelled left out`}
            />
            <StatCard label="Overdue tasks" icon={AlarmClock} tone={overdue.length ? "danger" : "success"} value={overdue.length} hint="Delayed activities" />
            <StatCard label="Behind plan" icon={Target} tone={behind.length ? "warning" : "success"} value={behind.length} hint="Overdue tasks, or tasks due after the planned end" />
            <StatCard label="Spending ahead of progress" icon={Scale} tone={costBehind.length ? "warning" : "success"} value={costBehind.length} hint="Cost performance below 1" />
          </StatGrid>
          {salariesHidden ? <SalariesHiddenNote className="-mt-2" /> : null}

          <Section title="Progress and outlook" description="One row per project. Scroll sideways on small screens." contentClassName="p-0 sm:p-0">
            <PerformanceTable rows={rows} />
          </Section>
          <RuleNote className="-mt-2">
            Progress is completed tasks out of the project&apos;s tasks, cancelled ones left out. Expected by tasks is the latest due date among open tasks.
            Budget used up is the day the budget runs out if spending continues at the rate since the planned start; it is shown only where the project cost
            forecast has a spend rate (a start at least {MIN_PROJECT_DAYS} days ago, a planned end not passed and some spend). Cost performance is progress divided by
            the share of the budget spent: above 1, more work is done than money spent in proportion; below 1, the reverse. The project records no completion
            date, so a completed project shows the day its last task was done.
          </RuleNote>

          <Section
            title="Delayed activities"
            description="Tasks due before today that are not completed or cancelled, the longest overdue first."
            contentClassName={overdue.length ? "p-0 sm:p-0" : undefined}
          >
            {overdue.length ? <OverdueTable rows={overdue} /> : <EmptyState compact icon={AlarmClock} title="No overdue task on these projects" />}
          </Section>

          <NotRecorded title="Major operational issues are not recorded">
            The ERP has no log of site issues, incidents or blockers. Overdue tasks above are the recorded sign of delays.
            {noProjectTasks ? ` ${plural(noProjectTasks, "open task has", "open tasks have")} no project and are not counted here.` : ""}
          </NotRecorded>
        </>
      )}
    </Page>
  );
}
