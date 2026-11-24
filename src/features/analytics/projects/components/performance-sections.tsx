import Link from "next/link";
import { PriorityBadge } from "@/components/shared/status-badge";
import { PROJECT_STATUSES, labelOf } from "@/lib/constants";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GridTable, ProjectCell, WrapHead, plural, type Column } from "@/features/analytics/inventory/components/table-kit";
import type { OverdueTask, PerformanceRow } from "../performance-queries";

/** Tables of the project performance page. Server components. */

const date = (d: string | null, empty: string) => (d ? <span className="whitespace-nowrap">{formatDate(fromDateInput(d))}</span> : <span className="text-xs text-muted-foreground">{empty}</span>);

function Progress({ r }: { r: PerformanceRow }) {
  const t = r.tasks;
  if (t.progress === null) return <span className="text-xs text-muted-foreground">No tasks</span>;
  return (
    <div className="min-w-28 space-y-1">
      <div className="flex h-4 items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-success" style={{ width: `${Math.min(100, t.progress * 100)}%` }} />
        </span>
        <span className="tabular w-9 text-right text-xs leading-none font-medium">{formatPercent(t.progress)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatNumber(t.completed)} of {plural(t.total, "task", "tasks")} done
      </p>
    </div>
  );
}

function ExpectedByTasks({ r }: { r: PerformanceRow }) {
  const end = r.project.endDate;
  const due = r.latestOpenDue;
  if (r.tasks.open === 0) return <span className="text-xs text-muted-foreground">{r.tasks.total ? "No open tasks" : "No tasks"}</span>;
  if (!due) return <span className="block max-w-28 text-xs whitespace-normal text-muted-foreground">Open tasks have no due date</span>;
  const late = end !== null && due > end;
  return (
    <div>
      <span className={cn("whitespace-nowrap", late && "font-medium text-danger")}>{formatDate(fromDateInput(due))}</span>
      {late ? <span className="block text-xs whitespace-normal text-danger">After the planned end</span> : null}
      {r.tasks.undated ? <span className="block max-w-32 text-xs whitespace-normal text-muted-foreground">{formatNumber(r.tasks.undated)} open without a due date</span> : null}
    </div>
  );
}

function BudgetUsedUp({ r }: { r: PerformanceRow }) {
  if (r.project.prediction.basis === "actual") return <span className="text-xs text-muted-foreground">Closed</span>;
  if (r.project.status === "on_hold") return <span className="text-xs text-muted-foreground">On hold</span>;
  if (!r.budgetUsedUp) {
    const p = r.project;
    const why = p.budget <= 0 ? "No budget" : p.prediction.basis !== "rate" ? p.prediction.note : "Not started yet";
    return <span className="block max-w-32 text-xs whitespace-normal text-muted-foreground">{why}</span>;
  }
  const early = r.project.endDate !== null && r.budgetUsedUp < r.project.endDate;
  return (
    <div>
      <span className={cn("whitespace-nowrap", early && "font-medium text-danger")}>{formatDate(fromDateInput(r.budgetUsedUp))}</span>
      {early ? <span className="block text-xs whitespace-normal text-danger">Before the planned end</span> : null}
    </div>
  );
}

function CostPerformance({ r }: { r: PerformanceRow }) {
  if (r.costPerformance === null) return <span className="text-xs text-muted-foreground">Not enough data</span>;
  const good = r.costPerformance >= 1;
  return (
    <div>
      <span className={cn("tabular font-medium", good ? "text-success" : "text-danger")}>{r.costPerformance.toFixed(2)}</span>
      <span className="block max-w-28 text-xs whitespace-normal text-muted-foreground">
        {formatPercent(r.tasks.progress)} done, {formatPercent(r.project.utilisation)} spent
      </span>
    </div>
  );
}

/**
 * One row per project. Sized to fit a full-width card at 1440px: the status sits under the project
 * name, long headers and notes wrap, and the amount spent is left to the cost pages (the cost
 * performance column shows the share spent).
 */
export function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  const columns: Column<PerformanceRow>[] = [
    {
      key: "project",
      header: "Project",
      cell: (r) => <ProjectCell id={r.project.id} name={r.project.name} code={`${r.project.code} · ${labelOf(PROJECT_STATUSES, r.project.status)}`} color={r.project.color} />,
    },
    { key: "progress", header: "Progress", cell: (r) => <Progress r={r} /> },
    { key: "planned", header: <WrapHead>Planned end</WrapHead>, cell: (r) => date(r.project.endDate, "Not set") },
    { key: "expected", header: <WrapHead>Expected by tasks</WrapHead>, cell: (r) => <ExpectedByTasks r={r} /> },
    { key: "budget", header: <WrapHead>Budget used up at spend rate</WrapHead>, cell: (r) => <BudgetUsedUp r={r} /> },
    {
      key: "actual",
      header: <WrapHead>Actual completion</WrapHead>,
      cell: (r) =>
        r.project.status === "completed" ? (
          <div>
            <span className="text-xs">Completed</span>
            <span className="block max-w-28 text-xs whitespace-normal text-muted-foreground">
              {r.lastCompleted ? `Last task done ${formatDate(fromDateInput(r.lastCompleted))}` : "Date not recorded"}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not completed</span>
        ),
    },
    { key: "cpi", header: <WrapHead>Cost performance</WrapHead>, cell: (r) => <CostPerformance r={r} /> },
    {
      key: "people",
      header: "People",
      align: "right",
      cell: (r) => (r.people ? <span title="Full-time equivalent">{formatNumber(r.people)} ({formatNumber(r.fte)} FTE)</span> : <span className="text-muted-foreground">None</span>),
    },
    {
      key: "overdue",
      header: <WrapHead>Overdue tasks</WrapHead>,
      align: "right",
      cell: (r) => <span className={cn(r.tasks.overdue ? "font-medium text-danger" : "text-muted-foreground")}>{formatNumber(r.tasks.overdue)}</span>,
    },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.project.id} minWidth={1000} />;
}

export function OverdueTable({ rows }: { rows: OverdueTask[] }) {
  const columns: Column<OverdueTask>[] = [
    {
      key: "task",
      header: "Task",
      cell: (r) => (
        <div className="min-w-0 max-w-72">
          <Link href={`/tasks/all?task=${r.id}`} className="block truncate font-medium hover:underline">
            {r.title}
          </Link>
          <span className="text-xs text-muted-foreground">{r.number}</span>
        </div>
      ),
    },
    { key: "project", header: "Project", cell: (r) => <ProjectCell id={r.projectId} name={r.projectName} color={r.color} /> },
    { key: "assignee", header: "Assignee", cell: (r) => r.assignee ?? <span className="text-muted-foreground">Unassigned</span> },
    { key: "priority", header: "Priority", cell: (r) => <PriorityBadge priority={r.priority} /> },
    { key: "due", header: "Due", cell: (r) => date(r.dueDate, "") },
    { key: "late", header: "Days late", align: "right", cell: (r) => <span className="font-medium text-danger">{formatNumber(r.daysLate)}</span> },
  ];
  return <GridTable rows={rows} columns={columns} rowKey={(r) => r.id} minWidth={820} />;
}
