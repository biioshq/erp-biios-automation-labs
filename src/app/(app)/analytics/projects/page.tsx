import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, FolderKanban, Gauge, PiggyBank, Receipt, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatCompactCurrency, formatPercent } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { SPEND_TYPES } from "@/lib/project-cost-types";
import { BUDGET_USE_RULE, budgetUse, statusesParam, sumOf } from "@/features/analytics/projects/model";
import { MIN_PROJECT_DAYS, PROJECT_FORECAST_RULE } from "@/features/analytics/project-forecast";
import { loadProjectCosts } from "@/features/analytics/projects/queries";
import { MoneyBars } from "@/features/analytics/inventory/components/charts";
import { GridTable, RuleNote, plural, type Column } from "@/features/analytics/inventory/components/table-kit";
import { CostTable } from "@/features/analytics/projects/components/cost-sections";
import { ProjectStatusSelect } from "@/features/analytics/projects/components/project-filter";

export const metadata: Metadata = { title: "Project cost analysis" };

const TYPE_COLORS: Record<string, string> = {
  material: "var(--chart-1)",
  labour: "var(--chart-2)",
  equipment: "var(--chart-3)",
  transport: "var(--chart-4)",
  other: "var(--chart-5)",
};

export default async function ProjectCostPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.projects)) return <NoAccess eyebrow="Analytics & Planning" title="Project cost analysis" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const statuses = statusesParam(await searchParams);
  const { rows, total, salariesHidden } = await loadProjectCosts(statuses);

  const budget = sumOf(rows, (r) => r.budget);
  const spent = sumOf(rows, (r) => r.spent);
  const remaining = sumOf(rows, (r) => r.estimatedRemaining);
  const use = budgetUse(rows);
  // Every project with a figure: rate predictions, spend to date (past the planned end or on hold)
  // and the actual spend of closed projects. The hint says how many of each.
  const predicted = rows.filter((r) => r.prediction.value !== null);
  const basisCount = (b: string) => predicted.filter((r) => r.prediction.basis === b).length;
  const predictedParts = [
    basisCount("rate") ? `${basisCount("rate")} by spend rate` : null,
    basisCount("spend_to_date") ? `${basisCount("spend_to_date")} at spend to date` : null,
    basisCount("actual") ? `${basisCount("actual")} closed at actual spend` : null,
  ].filter(Boolean);
  const predictedTotal = sumOf(predicted, (r) => r.prediction.value ?? 0);
  const predictedBudget = sumOf(predicted, (r) => r.budget);
  const typeTotals = SPEND_TYPES.map((t) => ({ key: t.key, label: t.label, amount: sumOf(rows, (r) => r.byType[t.key]) }));
  const withSpend = rows.filter((r) => r.spent > 0);
  const chart = withSpend.map((r) => ({ label: r.code || r.name, ...r.byType }));
  const summary = `Spend by cost type per project. ${withSpend
    .map((r) => `${r.name}: ${SPEND_TYPES.map((t) => `${t.label.toLowerCase()} ${formatCompactCurrency(r.byType[t.key])}`).join(", ")}`)
    .join("; ")}.`;

  const typeColumns: Column<(typeof typeTotals)[number]>[] = [
    {
      key: "type",
      header: "Cost type",
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <span className="size-2.5 rounded-[3px]" style={{ background: TYPE_COLORS[r.key] }} aria-hidden />
          {r.label}
        </span>
      ),
    },
    { key: "amount", header: "Spent", align: "right", cell: (r) => <Money value={r.amount} /> },
    { key: "share", header: "Share", align: "right", cell: (r) => (spent > 0 ? formatPercent(r.amount / spent) : "0%") },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Project cost analysis"
        description="Each project's estimated cost against what it has spent, split into materials, labour, equipment, transportation and other costs, with the final cost its spend rate points to."
        actions={
          <>
            <ProjectStatusSelect statuses={statuses} />
            {open("/analytics/projects/budget") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/projects/budget">
                  <Gauge /> Budget vs actual
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project with a budget. Its expenses and the stock assigned to it then show here by cost type."
          action={
            open("/finance/projects?new=1") ? (
              <Button asChild>
                <Link href="/finance/projects?new=1">New project</Link>
              </Button>
            ) : null
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title="No projects with this status" description="Pick another status to see those projects." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Total estimated cost" icon={Wallet} tone="info" value={<Money value={budget} />} hint={`Budgets of ${plural(rows.length, "project", "projects")}`} />
            <StatCard
              label="Actual expenditure"
              icon={Receipt}
              tone="brand"
              value={<Money value={spent} />}
              hint={use.usage !== null ? `${formatPercent(use.usage)} of the budget used, ${plural(use.projects, "project", "projects")} with a budget` : "No budgets set"}
            />
            <StatCard label="Remaining estimated" icon={PiggyBank} tone="success" value={<Money value={remaining} />} hint="Budget not yet spent on open projects" />
            <StatCard
              label="Predicted final cost"
              icon={Calculator}
              tone={predictedTotal > predictedBudget && predictedBudget > 0 ? "danger" : "default"}
              value={predicted.length ? <Money value={predictedTotal} /> : "Not enough data"}
              hint={
                predicted.length ? (
                  <>
                    {predictedParts.join(", ")}; their budgets <Money value={predictedBudget} />
                  </>
                ) : (
                  `Needs a start ${MIN_PROJECT_DAYS} days back, a planned end and some spend`
                )
              }
            />
          </StatGrid>
          {salariesHidden ? <SalariesHiddenNote className="-mt-2" /> : null}

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
            <Section title="Spend by cost type, per project" description="Actual expenditure of each project, stacked by type." className="lg:col-span-2">
              {chart.length ? (
                <MoneyBars data={chart} labelKey="label" series={SPEND_TYPES.map((t) => ({ key: t.key, label: t.label, color: TYPE_COLORS[t.key] }))} stacked summary={summary} />
              ) : (
                <EmptyState compact icon={Receipt} title="No spend recorded on these projects yet" />
              )}
            </Section>
            <Section title="All projects shown" description="Spend by cost type, added up." contentClassName="p-0 sm:p-0">
              <GridTable rows={typeTotals} columns={typeColumns} rowKey={(r) => r.key} minWidth={280} />
            </Section>
          </div>

          <Section title="Cost by project" description="Budget, spend by type, what is left and the predicted final cost." contentClassName="p-0 sm:p-0">
            <CostTable rows={rows} />
          </Section>
          <RuleNote>
            Cost types follow the expense category: materials and inventory are materials; labour, contractors and salaries are labour; equipment is
            equipment; logistics and travel are transportation; every other category, custom ones included, is other. Remaining estimated is the budget not
            yet spent on open projects (nothing on completed or cancelled ones). Budget used: {BUDGET_USE_RULE} Predicted final cost: {PROJECT_FORECAST_RULE}
          </RuleNote>
        </>
      )}
    </Page>
  );
}
