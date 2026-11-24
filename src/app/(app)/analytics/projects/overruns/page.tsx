import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, FolderKanban, Gauge, History, LineChart, OctagonAlert, Search, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatCompactCurrency, formatMonth } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { idParam } from "@/features/analytics/inventory/params";
import { statusesParam, sumOf } from "@/features/analytics/projects/model";
import { PROJECT_FORECAST_RULE } from "@/features/analytics/project-forecast";
import { loadProjectCosts } from "@/features/analytics/projects/queries";
import { firstOverrunMonth, spendTrend, stageOverruns, type StageOverrun } from "@/features/analytics/projects/overrun-queries";
import { SpendVsBudget } from "@/features/analytics/inventory/components/charts";
import { RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { AtRiskTable, OverrunTable, StageOverrunTable } from "@/features/analytics/projects/components/overrun-sections";
import { ProjectPicker, ProjectStatusSelect } from "@/features/analytics/projects/components/project-filter";

export const metadata: Metadata = { title: "Cost overruns" };

export default async function OverrunsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const statuses = statusesParam(sp);
  const { rows, total, salariesHidden } = await loadProjectCosts(statuses);
  const over = rows.filter((r) => r.overrun > 0).sort((a, b) => b.overrun - a.overrun);
  const atRisk = rows.filter((r) => r.overrun === 0 && r.prediction.basis === "rate" && (r.predictedOverrun ?? 0) > 0).sort((a, b) => (b.predictedOverrun ?? 0) - (a.predictedOverrun ?? 0));
  const overOriginal = rows.filter((r) => r.originalBudget > 0 && r.spent > r.originalBudget);
  const stages = stageOverruns(rows);
  const stagesBy = new Map<string, StageOverrun[]>();
  for (const s of stages) stagesBy.set(s.projectId, [...(stagesBy.get(s.projectId) ?? []), s]);

  const withSpend = rows.filter((r) => r.spent > 0);
  const fallback = (over[0] ?? [...withSpend].sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0))[0])?.id ?? "";
  const picked = idParam(sp, "project");
  const trendProject = rows.find((r) => r.id === picked) ?? rows.find((r) => r.id === fallback) ?? null;
  const trend = trendProject ? await spendTrend(trendProject) : null;
  const firstOver = trend ? firstOverrunMonth(trend.points) : null;
  const summary = trend
    ? `Cumulative spend against budget for ${trendProject?.name}. ${trend.points.map((p) => `${p.label}: spent to date ${formatCompactCurrency(p.cumulative)}, budget ${formatCompactCurrency(p.budget)}`).join("; ")}.`
    : "";

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Cost overruns"
        description="Projects spending above their budget, by how much, which costs drove it, and how spend climbed against the budget month by month."
        actions={
          <>
            <ProjectStatusSelect statuses={statuses} />
            <Button asChild variant="outline">
              <Link href="/analytics/projects/budget">
                <Gauge /> Budget vs actual
              </Link>
            </Button>
          </>
        }
      />

      {total === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Create a project with a budget to track overruns against it." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title="No projects with this status" description="Pick another status to see those projects." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Projects over budget" icon={OctagonAlert} tone={over.length ? "danger" : "success"} value={over.length} hint={`Of ${plural(rows.filter((r) => r.budget > 0).length, "project", "projects")} with a budget`} />
            <StatCard label="Total overrun" icon={TrendingUp} tone={over.length ? "danger" : "default"} value={<Money value={sumOf(over, (r) => r.overrun)} />} hint="Spend above the current budgets" />
            <StatCard
              label="Over the original budget"
              icon={History}
              tone={overOriginal.length ? "warning" : "default"}
              value={overOriginal.length}
              hint={<>by <Money value={sumOf(overOriginal, (r) => r.spent - r.originalBudget)} /> in total</>}
            />
            <StatCard label="Predicted to overrun" icon={LineChart} tone={atRisk.length ? "warning" : "success"} value={atRisk.length} hint="Within budget now, over it at the spend rate to the planned end" />
          </StatGrid>
          {salariesHidden ? <SalariesHiddenNote className="-mt-2" /> : null}

          <Section title="Projects with cost overruns" description="Amount and share over the current budget, the original budget, and the costs behind the spend." contentClassName={over.length ? "p-0 sm:p-0" : undefined}>
            {over.length ? (
              <OverrunTable rows={over} stagesBy={stagesBy} />
            ) : (
              <EmptyState compact icon={CircleCheck} title="No project is over its budget" />
            )}
          </Section>

          <Section
            title="Predicted to overrun"
            description="Open projects within budget today whose spend rate, carried to the planned end, goes over it."
            contentClassName={atRisk.length ? "p-0 sm:p-0" : undefined}
          >
            {atRisk.length ? <AtRiskTable rows={atRisk} /> : <EmptyState compact icon={LineChart} title="No open project is heading over budget at its current spend rate" />}
          </Section>

          <Section title="Stages over their own budget" description="Stages with a stage budget whose spend went above it." contentClassName={stages.length ? "p-0 sm:p-0" : undefined}>
            {stages.length ? (
              <StageOverrunTable rows={stages} />
            ) : (
              <EmptyState compact icon={CircleCheck} title="No stage is over its own budget" description="Stage budgets are set in a project's Edit form." />
            )}
          </Section>

          <Section
            title={trendProject ? `Overrun trend: ${trendProject.name}` : "Overrun trend"}
            description={
              trendProject && firstOver
                ? `Spend first went above the budget in force in ${formatMonth(fromDateInput(`${firstOver}-01`))}.`
                : "Cumulative spend each month against the budget in force at the end of that month."
            }
            actions={
              withSpend.length ? (
                <ProjectPicker
                  value={trendProject?.id ?? fallback}
                  fallback={fallback}
                  options={withSpend
                    .concat(trendProject && !withSpend.includes(trendProject) ? [trendProject] : [])
                    .map((r) => ({ value: r.id, label: r.name }))}
                />
              ) : null
            }
          >
            {trend && trend.points.length ? (
              <SpendVsBudget data={trend.points} summary={summary} />
            ) : (
              <EmptyState compact icon={LineChart} title="No spend recorded on this project yet" />
            )}
          </Section>
          <RuleNote>
            A project overruns when it has spent more than its current budget. The budget line steps where the budget was revised, from the project&apos;s
            budget history. Cost categories are listed by their share of the project&apos;s whole spend; where stage budgets are set, stages above theirs are
            shown too. Predicted to overrun uses the project cost forecast rule: {PROJECT_FORECAST_RULE}
          </RuleNote>
        </>
      )}
    </Page>
  );
}
