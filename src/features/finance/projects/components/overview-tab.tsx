import Link from "next/link";
import { ArrowRight, Boxes, ListTodo, PiggyBank, Receipt, Users, Wallet, WalletCards } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { Section } from "@/components/shared/page";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BUDGET_TEXT_CLASS, budgetTone, deadlineLabel, timeElapsed } from "../utils";
import { getProjectTimeline, stageRows } from "../queries";
import type { ProjectDetail } from "../types";
import { BudgetBar } from "./project-budget-bar";
import { StageChart } from "./stage-chart";
import { TimelineItem } from "./timeline-item";

/** Tighter tiles on phones so two fit across at 360px. */
const KPI = "max-sm:p-4 max-sm:[&>.tabular]:text-xl";

export async function OverviewTab({ project }: { project: ProjectDetail }) {
  const events = (await getProjectTimeline(project, 12)).filter((e) => e.kind !== "start" && e.kind !== "end").slice(0, 5);
  const tone = budgetTone(project.usage, project.budget);
  const elapsed = timeElapsed(project.startDate, project.endDate);
  const deadline = deadlineLabel(project.endDate, project.status);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard className={KPI} label="Total budget" value={<Money value={project.budget} compact />} icon={Wallet} tone="info" hint={project.budget > 0 ? undefined : "No budget set"} />
        <StatCard
          className={KPI}
          label="Total spent"
          value={<Money value={project.spent} compact />}
          icon={Receipt}
          tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "brand"}
          hint={project.budget > 0 ? `${formatPercent(project.usage)} of budget` : `${formatNumber(project.expenseCount)} expenses`}
          footer={<BudgetBar spent={project.spent} budget={project.budget} />}
        />
        <StatCard
          className={KPI}
          label="Remaining"
          value={<Money value={project.remaining} compact tone={project.remaining < 0 ? "negative" : undefined} />}
          icon={PiggyBank}
          tone={project.remaining < 0 ? "danger" : "success"}
          hint={project.remaining < 0 ? "Over budget" : "Left to spend"}
        />
        <StatCard className={KPI} label="Income received" value={<Money value={project.income} compact />} icon={WalletCards} tone="success" hint={project.income > 0 ? "From the client" : "None recorded yet"} />
        <StatCard className={KPI} label="Inventory value used" value={<Money value={project.inventoryValue} compact />} icon={Boxes} tone="info" hint="Stock the project holds" />
        <StatCard
          className={KPI}
          label="Team"
          value={formatNumber(project.teamSize)}
          icon={Users}
          tone="info"
          hint={project.teamSize === 0 ? "Nobody assigned yet" : project.teamSize === 1 ? "person on the project" : "people on the project"}
          footer={
            <Link href="?tab=team" scroll={false} className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
              View team <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2">
          <Section
            title="Spend by stage"
            description="Every expense belongs to one stage."
            actions={
              <Link href="?tab=budget" scroll={false} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                Stage budget <ArrowRight className="size-3" />
              </Link>
            }
          >
            <StageChart rows={stageRows(project)} />
          </Section>
          <Section title="About this project">
            {project.description ? (
              <p className="max-w-prose text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{project.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description yet. Add scope and deliverables with Edit.</p>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Section title="Schedule">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="eyebrow text-[10px]">Start</dt>
                <dd className="mt-1 font-medium">{project.startDate ? formatDate(project.startDate) : "Not set"}</dd>
              </div>
              <div>
                <dt className="eyebrow text-[10px]">End</dt>
                <dd className="mt-1 font-medium">{project.endDate ? formatDate(project.endDate) : "Not set"}</dd>
              </div>
            </dl>
            {elapsed !== null ? (
              <div className="mt-4 space-y-2">
                <div
                  role="progressbar"
                  aria-label="Time elapsed"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(elapsed * 100)}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-chart-3" style={{ width: `${elapsed * 100}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground tabular">{formatPercent(elapsed)} of the time used</span>
                  {deadline ? <span className={cn("font-medium", deadline.late ? "text-danger" : "text-foreground/80")}>{deadline.text}</span> : null}
                </div>
                {budgetTone(project.usage, project.budget) !== "ok" && elapsed < project.usage ? (
                  <p className={cn("text-xs", BUDGET_TEXT_CLASS[tone])}>Budget is being used faster than time.</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Set both dates to track time against the budget.</p>
            )}
          </Section>

          <Link
            href={`/tasks/all?project=${project.id}`}
            className="group flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-card sm:p-5 transition-colors hover:border-foreground/20"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-chart-4/12 text-chart-4">
                <ListTodo className="size-4" />
              </span>
              <div>
                <p className="tabular text-xl leading-none font-semibold">{formatNumber(project.openTasks)}</p>
                <p className="mt-1 text-xs text-muted-foreground">open task{project.openTasks === 1 ? "" : "s"}</p>
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Section
            title="Recent activity"
            actions={
              <Link href="?tab=timeline" scroll={false} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                Full timeline <ArrowRight className="size-3" />
              </Link>
            }
          >
            {events.length ? (
              <ul>
                {events.map((e, i) => (
                  <TimelineItem key={e.id} event={e} last={i === events.length - 1} compact />
                ))}
              </ul>
            ) : (
              <EmptyState compact title="No activity yet" description="Expenses, stock and tasks appear here as they happen." />
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
