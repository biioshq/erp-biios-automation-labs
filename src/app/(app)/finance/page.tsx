import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, BarChart3, Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { formatNumber } from "@/lib/format";
import { parsePeriodParams } from "@/features/finance/dashboard/periods";
import { getFinanceDashboard } from "@/features/finance/dashboard/queries";
import { PeriodSwitcher } from "@/features/finance/dashboard/components/period-switcher";
import { KpiCards } from "@/features/finance/dashboard/components/kpi-cards";
import { TrendChart } from "@/features/finance/dashboard/components/trend-chart";
import { OpenItemsCards, PositionCards } from "@/features/finance/dashboard/components/position-cards";
import { DuePaymentsSections } from "@/features/finance/dashboard/components/due-payments";
import { ProjectSummaryTable } from "@/features/finance/dashboard/components/project-summary";
import { CategoryChart } from "@/features/finance/dashboard/components/category-chart";
import { BudgetUsage } from "@/features/finance/dashboard/components/budget-usage";
import { RecentTransactions } from "@/features/finance/dashboard/components/recent-transactions";
import { GstSummary, QuickActions, RecurringCommitmentsCard, ShortcutLinks } from "@/features/finance/dashboard/components/side-cards";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceDashboardPage({ searchParams }: PageProps<"/finance">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.dashboard:view")) return <NoAccess title="Finance dashboard" />;
  // Balance sheet, cash and loan figures need their own data permission.
  const seesPosition = can(user, "data.financial_position");
  const selection = parsePeriodParams(await searchParams);
  const data = await getFinanceDashboard(selection, { financialPosition: seesPosition });
  const hasTrend = [...data.trends.month, ...data.trends.quarter, ...data.trends.year].some((m) => m.income > 0 || m.expenses > 0);
  const hasCategories = data.categories.total > 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Dashboard"
        description={
          <>
            {seesPosition ? "Income, spending, cash, the balance sheet and project budgets" : "Income, spending and project budgets"} for{" "}
            {data.periodLabel.toLowerCase() === "all time" ? "all time" : data.periodLabel}.{" "}
            <span className="tabular">{formatNumber(data.kpis.activeProjects)}</span> active {data.kpis.activeProjects === 1 ? "project" : "projects"}.
          </>
        }
        actions={<PeriodSwitcher value={data.period} custom={data.custom} />}
      />

      {data.empty ? (
        <EmptyState
          icon={BarChart3}
          title="Nothing recorded yet"
          description="Add your first expense or income and this dashboard fills in. Totals, charts and project budgets all come from those records."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/finance/expenses?new=1">
                  <Plus /> Add expense
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/finance/income?new=1">
                  <BadgeIndianRupee /> Record income
                </Link>
              </Button>
            </div>
          }
        />
      ) : null}

      <KpiCards data={data} />

      {data.position ? <PositionCards position={data.position} periodLabel={data.periodLabel} /> : null}

      <OpenItemsCards data={data} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Income vs expenses" description="Income and expenses recorded, with profit as the line" className="xl:col-span-2" contentClassName="pt-4">
          {hasTrend ? (
            <TrendChart trends={data.trends} />
          ) : (
            <EmptyState compact icon={BarChart3} title="No income or expenses in the last five financial years" description="Monthly, quarterly and yearly bars and the profit line appear once you record transactions." />
          )}
        </Section>
        <Section title="Budget usage" description="Spent against budget, open projects" contentClassName="p-3">
          <SalariesHiddenNote className="px-1 pb-2" />
          <BudgetUsage rows={data.budgets} />
        </Section>
      </div>

      <DuePaymentsSections due={data.due} seesPosition={seesPosition} />

      <Section
        title="Project-wise summary"
        description="Open projects with the most spend. Revenue is invoices plus payments without an invoice; profit uses the project value and the expected final cost."
        contentClassName="p-0"
        actions={
          <div className="flex items-center gap-3 text-xs font-medium">
            <Link href="/finance/projects/profitability" className="text-brand-ink hover:underline">
              Profitability
            </Link>
            <Link href="/finance/projects" className="text-brand-ink hover:underline">
              All projects
            </Link>
          </div>
        }
      >
        <SalariesHiddenNote className="px-4 pt-3 sm:px-5" />
        <ProjectSummaryTable rows={data.projectSummaries} />
      </Section>

      {/* Recent transactions sit under the chart, so the left column runs as long as the cards on the right. */}
      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Section title="Monthly expenses" description="Last 6 months by category" contentClassName="pt-4">
            {hasCategories ? (
              <CategoryChart data={data.categories} />
            ) : (
              <EmptyState
                compact
                icon={Receipt}
                title="No expenses in the last 6 months"
                description="The category breakdown appears after your first expense."
                action={
                  <Link href="/finance/expenses?new=1" className="text-sm font-medium text-brand-ink hover:underline">
                    Add expense
                  </Link>
                }
              />
            )}
          </Section>
          <Section
            title="Recent transactions"
            description="Latest income and expenses"
            contentClassName="px-3 py-1"
            actions={
              <div className="flex items-center gap-3 text-xs font-medium">
                <Link href="/finance/income" className="text-brand-ink hover:underline">
                  All income
                </Link>
                <Link href="/finance/expenses" className="text-brand-ink hover:underline">
                  All expenses
                </Link>
              </div>
            }
          >
            <RecentTransactions items={data.transactions} />
          </Section>
        </div>
        <div className="flex flex-col gap-4">
          <GstSummary data={data} />
          <RecurringCommitmentsCard data={data} />
          <QuickActions can={(p) => can(user, p)} />
          <ShortcutLinks can={(p) => can(user, p)} />
        </div>
      </div>
    </Page>
  );
}
