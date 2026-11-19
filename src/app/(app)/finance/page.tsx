import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, BarChart3, Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { formatNumber } from "@/lib/format";
import { parsePeriod } from "@/features/finance/dashboard/periods";
import { getFinanceDashboard } from "@/features/finance/dashboard/queries";
import { PeriodSwitcher } from "@/features/finance/dashboard/components/period-switcher";
import { KpiCards } from "@/features/finance/dashboard/components/kpi-cards";
import { IncomeExpenseChart } from "@/features/finance/dashboard/components/income-expense-chart";
import { CategoryChart } from "@/features/finance/dashboard/components/category-chart";
import { BudgetUsage } from "@/features/finance/dashboard/components/budget-usage";
import { RecentTransactions } from "@/features/finance/dashboard/components/recent-transactions";
import { GstSummary, QuickActions, RecurringCommitmentsCard } from "@/features/finance/dashboard/components/side-cards";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceDashboardPage({ searchParams }: PageProps<"/finance">) {
  const period = parsePeriod((await searchParams).period);
  const data = await getFinanceDashboard(period);
  const hasMonthly = data.monthly.some((m) => m.income > 0 || m.expenses > 0);
  const hasCategories = data.categories.total > 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Dashboard"
        description={
          <>
            Income, spending and project budgets for {data.periodLabel.toLowerCase() === "all time" ? "all time" : data.periodLabel}.{" "}
            <span className="tabular">{formatNumber(data.kpis.activeProjects)}</span> active {data.kpis.activeProjects === 1 ? "project" : "projects"}.
          </>
        }
        actions={<PeriodSwitcher value={data.period} />}
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

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Income vs expenses" description="Last 12 months, with profit as the line" className="xl:col-span-2" contentClassName="pt-4">
          {hasMonthly ? (
            <IncomeExpenseChart data={data.monthly} />
          ) : (
            <EmptyState compact icon={BarChart3} title="No income or expenses in the last 12 months" description="Monthly bars and the profit line appear once you record transactions." />
          )}
        </Section>
        <Section title="Budget usage" description="Spent against budget, open projects" contentClassName="p-3">
          <BudgetUsage rows={data.budgets} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <Section title="Monthly expenses" description="Last 6 months by category" className="xl:col-span-2" contentClassName="pt-4">
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
        <div className="flex flex-col gap-4">
          <GstSummary data={data} />
          <RecurringCommitmentsCard data={data} />
          <QuickActions />
        </div>
      </div>

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
    </Page>
  );
}
