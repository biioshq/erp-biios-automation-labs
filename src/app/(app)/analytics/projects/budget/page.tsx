import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, FolderKanban, History, OctagonAlert, Search, TriangleAlert, Wallet } from "lucide-react";
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
import { BUDGET_USE_RULE, budgetUse, statusesParam, sumOf } from "@/features/analytics/projects/model";
import { loadProjectCosts } from "@/features/analytics/projects/queries";
import { MoneyBars } from "@/features/analytics/inventory/components/charts";
import { RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { BudgetTable } from "@/features/analytics/projects/components/cost-sections";
import { ProjectStatusSelect } from "@/features/analytics/projects/components/project-filter";

export const metadata: Metadata = { title: "Budget vs actual" };

export default async function BudgetVsActualPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.projects)) return <NoAccess eyebrow="Analytics & Planning" title="Budget vs actual" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const statuses = statusesParam(await searchParams);
  const { rows, total, salariesHidden } = await loadProjectCosts(statuses);
  const budgeted = rows.filter((r) => r.budget > 0);
  const over = budgeted.filter((r) => r.spent > r.budget).sort((a, b) => b.overrun - a.overrun);
  const within = budgeted.filter((r) => r.spent <= r.budget);
  const original = sumOf(rows, (r) => r.originalBudget);
  const revised = sumOf(rows, (r) => r.budget);
  const spent = sumOf(rows, (r) => r.spent);
  const variance = sumOf(budgeted, (r) => r.remainingBudget);
  // The same measure as the dashboard's Budget used card: projects with a budget only.
  const use = budgetUse(rows);
  const chart = rows.map((r) => ({ label: r.code || r.name, original: r.originalBudget, revised: r.budget, actual: r.spent }));
  const summary = `Budget and actual spend per project. ${rows
    .map((r) => `${r.name}: original ${formatCompactCurrency(r.originalBudget)}, revised ${formatCompactCurrency(r.budget)}, actual ${formatCompactCurrency(r.spent)}`)
    .join("; ")}.`;

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Budget vs actual"
        description="Original and revised budgets of each project against its actual spend, with what is left, how much is used and which projects are over."
        actions={
          <>
            <ProjectStatusSelect statuses={statuses} />
            {open("/analytics/projects/overruns") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/projects/overruns">
                  <TriangleAlert /> Cost overruns
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {total === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Create a project with a budget to compare it with what is spent." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title="No projects with this status" description="Pick another status to see those budgets." />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Original budget"
              icon={History}
              tone="default"
              value={<Money value={original} />}
              hint={revised !== original ? <>Revised to <Money value={revised} /></> : "No budget revised"}
            />
            <StatCard
              label="Actual"
              icon={Wallet}
              tone="brand"
              value={<Money value={spent} />}
              hint={use.usage !== null ? `Budget used: ${formatPercent(use.usage)}, ${plural(use.projects, "project", "projects")} with a budget` : "No budgets set"}
            />
            <StatCard
              label="Variance"
              icon={variance < 0 ? OctagonAlert : CircleCheck}
              tone={variance < 0 ? "danger" : "success"}
              value={<Money value={variance} tone="auto" />}
              hint="Revised budget minus actual, projects with a budget"
            />
            <StatCard
              label="Over budget"
              icon={OctagonAlert}
              tone={over.length ? "danger" : "success"}
              value={over.length}
              hint={`${plural(within.length, "project", "projects")} within budget`}
            />
          </StatGrid>
          {salariesHidden ? <SalariesHiddenNote className="-mt-2" /> : null}

          <Section title="Budget against actual" description="Original budget, revised budget and actual spend of each project.">
            <MoneyBars
              data={chart}
              labelKey="label"
              series={[
                { key: "original", label: "Original budget", color: "var(--chart-4)" },
                { key: "revised", label: "Revised budget", color: "var(--chart-2)" },
                { key: "actual", label: "Actual", color: "var(--chart-1)" },
              ]}
              summary={summary}
            />
          </Section>

          <Section title="By project" description="Variance is the revised budget minus actual; negative means over budget." contentClassName="p-0 sm:p-0">
            <BudgetTable rows={rows} />
          </Section>

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <Section title="Over budget" description="Spent more than the revised budget, largest overrun first.">
              {over.length ? (
                <ul className="divide-y">
                  {over.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                      <Link href={`/finance/projects/${r.id}`} className="min-w-0 truncate font-medium hover:underline">
                        {r.name}
                      </Link>
                      <span className="text-sm">
                        <Money value={r.overrun} className="font-medium text-danger" />{" "}
                        <span className="text-muted-foreground">over, {formatPercent(r.spent / r.budget - 1)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon={CircleCheck} title="No project is over budget" />
              )}
            </Section>
            <Section title="Within budget" description="Spent no more than the revised budget, most used first.">
              {within.length ? (
                <ul className="divide-y">
                  {within
                    .sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0))
                    .map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                        <Link href={`/finance/projects/${r.id}`} className="min-w-0 truncate font-medium hover:underline">
                          {r.name}
                        </Link>
                        <span className="text-sm text-muted-foreground">
                          {formatPercent(r.utilisation)} used, <Money value={r.remainingBudget} /> left
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <EmptyState compact icon={Wallet} title="No project within a budget" />
              )}
            </Section>
          </div>
          <RuleNote>
            The original budget is the first one recorded for the project; the revised budget is the current one. Projects without a budget are left out of the
            variance and of both lists. Budget used: {BUDGET_USE_RULE}{" "}
            <Link href="/finance/projects/budgets" className="underline underline-offset-2">
              Stage budgets are on Budget tracking
            </Link>
            .
          </RuleNote>
        </>
      )}
    </Page>
  );
}
