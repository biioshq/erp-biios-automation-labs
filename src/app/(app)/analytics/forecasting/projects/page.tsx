import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { FolderKanban, OctagonAlert, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber, formatPercent, round2 } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { PROJECT_FORECAST_RULE } from "@/features/analytics/project-forecast";
import { BUDGET_USE_RULE, budgetUse } from "@/features/analytics/projects/model";
import type { SearchParams } from "@/features/analytics/forecasting/params";
import { projectCostForecast, projectSpendSeries } from "@/features/analytics/forecasting/server/projects";
import { ensureMonthSnapshot } from "@/features/analytics/forecasting/server/snapshots";
import { ProjectComparisonChart } from "@/features/analytics/forecasting/components/charts";
import { ProjectForecastTable } from "@/features/analytics/forecasting/components/project-forecast-table";
import { ProjectDetail } from "@/features/analytics/forecasting/components/project-detail";
import { ForecastFilters } from "@/features/analytics/forecasting/components/forecast-filters";
import { MethodNote } from "@/features/analytics/forecasting/components/notes";
import { SaveForecastButton } from "@/features/analytics/forecasting/components/save-forecast-button";
import { plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Project cost forecast" };

type Props = { searchParams: Promise<SearchParams> };

export default async function ProjectCostForecastPage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  // The month's forecast (with salaries, whoever is viewing) is stored once, after the page is sent.
  after(() => ensureMonthSnapshot("project_cost"));
  const rows = await projectCostForecast();

  if (rows.length === 0) {
    return (
      <Page>
        <PageHeader eyebrow="Analytics & Planning" title="Project cost forecast" />
        <EmptyState
          icon={FolderKanban}
          title="No open projects"
          description="Forecasts cover projects in planning, active or on hold. Completed and cancelled projects are in budget tracking."
          action={
            <Button asChild variant="outline">
              <Link href="/finance/projects/budgets">Budget tracking</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const picked = typeof sp.project === "string" ? rows.find((r) => r.id === sp.project) : undefined;
  const selected = picked ?? rows[0];
  const points = await projectSpendSeries(selected);

  const spent = round2(rows.reduce((s, r) => s + r.spent, 0));
  // Budget used: the same measure as the dashboard card (projects with a budget only).
  const use = budgetUse(rows);
  // Only rows with a run-rate prediction add up to a predicted total; the rest have none to add.
  const rated = rows.filter((r) => r.method === "run_rate" && r.predictedTotal !== null);
  const predicted = round2(rated.reduce((s, r) => s + (r.predictedTotal ?? 0), 0));
  const ratedBudget = round2(rated.reduce((s, r) => s + r.budget, 0));
  const over = rows.filter((r) => (r.variance ?? 0) > 0);
  const overAmount = round2(over.reduce((s, r) => s + (r.variance ?? 0), 0));
  const runRate = rated.length;
  const spendToDate = rows.filter((r) => r.method === "spend_to_date").length;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Project cost forecast"
        description="What each open project is likely to cost in total, from its spend so far and its planned dates, against its budget."
        actions={
          <>
            <SaveForecastButton />
            <Button asChild variant="outline">
              <Link href="/finance/projects/budgets">Budget tracking</Link>
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Open projects"
          icon={FolderKanban}
          tone="default"
          value={formatNumber(rows.length)}
          hint={`${plural(runRate, "project")} with a run rate${spendToDate ? `, ${formatNumber(spendToDate)} at spend to date` : ""}`}
        />
        <StatCard
          label="Spent to date"
          icon={Receipt}
          tone="brand"
          value={<Money value={spent} compact />}
          hint={use.usage !== null ? `Budget used: ${formatPercent(use.usage)}, ${plural(use.projects, "project")} with a budget` : "No budgets set"}
        />
        <StatCard
          label="Predicted total cost"
          icon={TrendingUp}
          tone="info"
          value={runRate ? <Money value={predicted} compact /> : "Not enough data"}
          hint={
            runRate ? (
              <>
                {plural(runRate, "project")} with a run rate, budgets <Money value={ratedBudget} compact />
              </>
            ) : (
              "No open project has a run rate yet"
            )
          }
        />
        <StatCard
          label="Expected overrun"
          icon={OctagonAlert}
          tone={over.length ? "danger" : "success"}
          value={<Money value={overAmount} compact tone={overAmount > 0 ? "negative" : undefined} />}
          hint={over.length ? `${plural(over.length, "project")} over budget by the forecast or already` : "None predicted over budget"}
        />
      </StatGrid>
      <SalariesHiddenNote className="-mt-2" />

      <MethodNote>
        <p>
          <span className="font-medium text-foreground">How this is worked out.</span> {PROJECT_FORECAST_RULE}
        </p>
        <p>
          Expected overrun or saving is the predicted total less the current budget; a project past its planned end, on hold or without a figure shows only spend
          already above the budget, never a saving. Budget left is shown as a fact and is not added to any prediction. Spend is every expense recorded on the
          project, as in budget tracking. Budget used: {BUDGET_USE_RULE}
        </p>
      </MethodNote>

      <Section title="Budget, spend and predicted total" description="All open projects side by side.">
        <ProjectComparisonChart rows={rows} />
      </Section>

      <Section title="Forecast by project" description="Select a project to see how its forecast is built." contentClassName="p-0 sm:p-0">
        <ProjectForecastTable rows={rows} />
      </Section>

      <Section
        title={selected.name}
        description={`${selected.code}${selected.client ? ` · ${selected.client}` : ""} · how this forecast is built`}
        actions={<ForecastFilters oneProject projects={rows.map((r) => ({ value: r.id, label: r.name }))} />}
      >
        <ProjectDetail row={selected} points={points} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/finance/projects/${selected.id}?tab=expenses`}>
              <Wallet /> Project expenses
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/finance/projects/${selected.id}?tab=budget`}>Budget</Link>
          </Button>
        </div>
      </Section>
    </Page>
  );
}
