import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, CircleCheckBig, ListTodo, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { requireUser } from "@/server/auth/session";
import { addDays, toDateInput } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { getTasksDashboard } from "@/features/tasks/queries";
import { CompletedPerWeekChart, PriorityChart, StatusChart } from "@/features/tasks/components/tasks-charts";
import { TaskList } from "@/features/tasks/components/task-list";
import { PersonAvatar } from "@/features/tasks/components/task-bits";

export const metadata: Metadata = { title: "Tasks Dashboard" };

const card = "block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export default async function TasksDashboardPage() {
  const user = await requireUser();
  const d = await getTasksDashboard(user.id);
  const total = d.byStatus.reduce((sum, s) => sum + s.count, 0);
  const today = toDateInput(new Date());
  const weekEnd = toDateInput(addDays(new Date(), 6));
  const maxOpen = Math.max(1, ...d.workload.map((w) => w.open));

  return (
    <Page>
      <PageHeader
        eyebrow="Tasks"
        title="Tasks dashboard"
        description="What is open, what is late and who has room."
        actions={
          <Button asChild className="max-sm:w-full">
            <Link href="/tasks/all?new=1" scroll={false}>
              <Plus /> New task
            </Link>
          </Button>
        }
      />

      <StatGrid className="xl:grid-cols-5">
        <Link href="/tasks/all?status=pending,in_progress,review" className={card}>
          <StatCard label="Open tasks" value={formatNumber(d.open)} icon={ListTodo} tone="info" hint={`of ${formatNumber(total)} in total`} className="h-full" />
        </Link>
        <Link href={`/tasks/all?status=pending,in_progress,review&from=${today}&to=${weekEnd}&sort=dueDate.asc`} className={card}>
          <StatCard label="Due this week" value={formatNumber(d.dueSoon)} icon={CalendarClock} tone="warning" hint="Next 7 days" className="h-full" />
        </Link>
        <Link href="/tasks/status/overdue" className={card}>
          <StatCard
            label="Overdue"
            value={<span className={d.overdue ? "text-danger" : undefined}>{formatNumber(d.overdue)}</span>}
            icon={AlarmClock}
            tone="danger"
            hint={d.overdue ? "Past their due date" : "Nothing is late"}
            className="h-full"
          />
        </Link>
        <Link href="/tasks/status/completed" className={card}>
          <StatCard label="Completed this month" value={formatNumber(d.completedThisMonth)} icon={CircleCheckBig} tone="success" className="h-full" />
        </Link>
        <Link href="/tasks/mine" className={card}>
          <StatCard label="My open tasks" value={formatNumber(d.myOpen)} icon={UserRound} tone="brand" hint="Assigned to you" className="h-full" />
        </Link>
      </StatGrid>

      {total === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks yet"
          description="Create the first task to see status, priority and workload charts here."
          action={
            <Button asChild>
              <Link href="/tasks/all?new=1" scroll={false}>
                <Plus /> New task
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Section title="Tasks by status" description="All tasks">
            <StatusChart data={d.byStatus} />
          </Section>
          <Section title="Open tasks by priority" description="Pending, in progress and review">
            <PriorityChart data={d.byPriority} />
          </Section>
          <Section title="Completed per week" description="Last 8 weeks" className="md:col-span-2 lg:col-span-1">
            <CompletedPerWeekChart data={d.completedPerWeek} />
          </Section>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Section
          title="Overdue"
          description="Oldest first"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/tasks/status/overdue">View all</Link>
            </Button>
          }
        >
          <TaskList tasks={d.overdueTasks} empty="Nothing overdue. Nice and tidy." />
        </Section>
        <Section
          title="Due soon"
          description="Next 7 days"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/tasks/calendar">Calendar</Link>
            </Button>
          }
        >
          <TaskList tasks={d.dueSoonTasks} empty="No open tasks fall due this week." />
        </Section>
        <Section
          className="md:col-span-2 lg:col-span-1"
          title="Recently completed"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/tasks/status/completed">View all</Link>
            </Button>
          }
        >
          <TaskList tasks={d.recentlyCompleted} empty="Completed tasks will show up here." showCompleted />
        </Section>
      </div>

      <Section title="Workload by assignee" description="Open tasks per person. Red shows how many of them are overdue.">
        {d.workload.length ? (
          <ul className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
            {d.workload.map((w) => (
              <li key={w.person?.id ?? "unassigned"} className="flex items-center gap-3">
                <PersonAvatar person={w.person} size="default" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={w.person ? `/tasks/all?assignee=${w.person.id}` : "/tasks/all?assignee=none"}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {w.person?.name ?? "Unassigned"}
                    </Link>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {formatNumber(w.open)} open
                      {w.overdue ? <span className="ml-1.5 text-danger">{formatNumber(w.overdue)} overdue</span> : null}
                    </span>
                  </div>
                  <Progress value={(w.open / maxOpen) * 100} aria-label={`${w.person?.name ?? "Unassigned"} has ${w.open} open tasks`} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="No team members yet" className="border-0" />
        )}
      </Section>
    </Page>
  );
}
