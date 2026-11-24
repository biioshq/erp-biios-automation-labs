import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, FolderKanban, Receipt, Scale, Search, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber, formatPercent, round2 } from "@/lib/format";
import { sumBy } from "@/features/finance/projects/finance";
import { listProjectFinances } from "@/features/finance/projects/queries";
import { parseStatuses } from "@/features/finance/projects/utils";
import { ProjectStatusFilter } from "@/features/finance/projects/components/status-filter";
import { ProfitabilityTable, SpendByTypeTable } from "@/features/finance/projects/components/profitability-view";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Project profitability" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProjectProfitabilityPage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const status = parseStatuses((await searchParams).status);
  const { rows, total } = await listProjectFinances(status);

  const revenue = sumBy(rows, (r) => r.finance.revenue.revenue);
  const value = sumBy(rows, (r) => r.outlook.projectValue);
  const spent = sumBy(rows, (r) => r.finance.spent);
  const finalCost = sumBy(rows, (r) => r.outlook.expectedFinalCost);
  const profit = round2(value - finalCost);
  const losing = rows.filter((r) => r.outlook.estimatedProfit < 0).length;
  const noValue = rows.filter((r) => r.outlook.valueBasis === "revenue").length;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Profitability"
        description="Revenue, actual expenses and the expected final cost of every project, and the profit or loss that leaves. Sort by any column to compare projects."
        actions={<ProjectStatusFilter />}
      />

      {total === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project and record its value, budget, invoices and expenses. Its profit shows here."
          action={
            <Button asChild>
              <Link href="/finance/projects?new=1">New project</Link>
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No projects with this status"
          description="Pick another status to compare those projects."
          action={
            <Button asChild variant="outline">
              <Link href="/finance/projects/profitability">Show all statuses</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Total revenue"
              value={<Money value={revenue} compact />}
              icon={BadgeIndianRupee}
              tone="success"
              hint="Invoices plus payments without an invoice"
            />
            <StatCard label="Actual expenses" value={<Money value={spent} compact />} icon={Receipt} tone="warning" hint={`Across ${formatNumber(rows.length)} ${rows.length === 1 ? "project" : "projects"}`} />
            <StatCard
              label="Expected final cost"
              value={<Money value={finalCost} compact />}
              icon={Scale}
              tone="info"
              hint={<>Spent plus <Money value={round2(finalCost - spent)} compact /> of unspent budget</>}
            />
            <StatCard
              label="Estimated profit or loss"
              value={<Money value={profit} compact tone={profit < 0 ? "negative" : undefined} />}
              icon={profit >= 0 ? TrendingUp : TrendingDown}
              tone={profit >= 0 ? "success" : "danger"}
              hint={
                value > 0
                  ? `${formatPercent(profit / value)} of project value${losing ? `, ${formatNumber(losing)} heading for a loss` : ""}`
                  : "No project value or revenue yet"
              }
            />
          </StatGrid>
          <SalariesHiddenNote className="-mt-2" />

          <Section
            title="Compare projects"
            description="Estimated remaining is the revised budget not yet spent (0 once a project is over budget, completed or cancelled). Estimated profit is the project value minus the expected final cost."
            contentClassName="p-0"
          >
            <ProfitabilityTable rows={rows} />
            {noValue > 0 ? (
              <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
                {formatNumber(noValue)} {noValue === 1 ? "project has" : "projects have"} no project value recorded, so the revenue so far is used instead. Add the
                value in the project&apos;s Edit form for a fuller forecast.
              </p>
            ) : null}
          </Section>

          <Section
            title="Project expenses by type"
            description="Materials and inventory, labour (labour, contractors and salaries), equipment, transportation (logistics and travel) and everything else."
            contentClassName="p-0"
          >
            <SpendByTypeTable rows={rows} />
          </Section>
        </>
      )}
    </Page>
  );
}
