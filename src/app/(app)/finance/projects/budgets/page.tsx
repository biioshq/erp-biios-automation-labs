import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, History, OctagonAlert, PiggyBank, Receipt, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { PROJECT_STAGES } from "@/lib/constants";
import { formatNumber, formatPercent, round2 } from "@/lib/format";
import { sumBy } from "@/features/finance/projects/finance";
import { listProjectFinances } from "@/features/finance/projects/queries";
import { parseStatuses } from "@/features/finance/projects/utils";
import type { ProjectFinanceRow } from "@/features/finance/projects/types";
import { ProjectStatusFilter } from "@/features/finance/projects/components/status-filter";
import { BudgetTrackingTable, StageBudgetTable, type StageBudgetRow } from "@/features/finance/projects/components/budgets-view";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Budget tracking" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Every stage that has a stage budget, with what that stage has spent. */
function stageBudgetRows(rows: ProjectFinanceRow[]): StageBudgetRow[] {
  return rows.flatMap((p) =>
    PROJECT_STAGES.filter((s) => (p.stageBudgets[s.value] ?? 0) > 0).map((s) => {
      const planned = p.stageBudgets[s.value];
      const spent = p.finance.byStage[s.value] ?? 0;
      return {
        key: `${p.id}:${s.value}`,
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        color: p.color,
        stageLabel: s.label,
        planned,
        spent,
        variance: round2(planned - spent),
      };
    }),
  );
}

export default async function BudgetTrackingPage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const status = parseStatuses((await searchParams).status);
  const { rows, total } = await listProjectFinances(status);

  const original = sumBy(rows, (r) => r.originalBudget);
  const revised = sumBy(rows, (r) => r.budget);
  const spent = sumBy(rows, (r) => r.finance.spent);
  const overrunRows = rows.filter((r) => r.outlook.overrun > 0);
  const overrun = sumBy(overrunRows, (r) => r.outlook.overrun);
  const closed = rows.filter((r) => r.outlook.potentialSavings !== null);
  const savings = sumBy(closed, (r) => r.outlook.potentialSavings ?? 0);
  const revisedCount = rows.filter((r) => r.outlook.budgetRevision !== 0).length;
  const stages = stageBudgetRows(rows);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Budget tracking"
        description="Original and revised budgets against what each project has actually spent, with overruns and the budget left unspent on closed projects."
        actions={<ProjectStatusFilter />}
      />

      {total === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project with a budget. Every expense recorded for it counts against that budget here."
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
          description="Pick another status to see those budgets."
          action={
            <Button asChild variant="outline">
              <Link href="/finance/projects/budgets">Show all statuses</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid className="xl:grid-cols-3">
            <StatCard
              label="Original budget"
              value={<Money value={original} compact />}
              icon={History}
              tone="default"
              hint={revisedCount ? `${formatNumber(revisedCount)} ${revisedCount === 1 ? "project" : "projects"} revised since` : "No budget revised"}
            />
            <StatCard
              label="Revised budget"
              value={<Money value={revised} compact />}
              icon={Wallet}
              tone="info"
              hint={
                revised !== original ? (
                  <>
                    {revised > original ? "+" : "-"}
                    <Money value={Math.abs(round2(revised - original))} compact /> against the original
                  </>
                ) : (
                  "Same as the original"
                )
              }
            />
            <StatCard
              label="Actual expenditure"
              value={<Money value={spent} compact />}
              icon={Receipt}
              tone="brand"
              hint={revised > 0 ? `${formatPercent(spent / revised)} of the revised budget used` : "No budget set"}
            />
            <StatCard
              label="Remaining budget"
              value={<Money value={round2(revised - spent)} compact tone={revised - spent < 0 ? "negative" : undefined} />}
              icon={PiggyBank}
              tone={revised - spent < 0 ? "danger" : "success"}
              hint="Revised budget minus actual expenditure"
            />
            <StatCard
              label="Overrun"
              value={<Money value={overrun} compact tone={overrun > 0 ? "negative" : undefined} />}
              icon={OctagonAlert}
              tone={overrun > 0 ? "danger" : "success"}
              hint={overrunRows.length ? `${formatNumber(overrunRows.length)} ${overrunRows.length === 1 ? "project" : "projects"} over budget` : "No project over budget"}
            />
            <StatCard
              label="Savings on closed projects"
              value={<Money value={savings} compact />}
              icon={PiggyBank}
              tone="success"
              hint={closed.length ? `Budget left unspent on ${formatNumber(closed.length)} completed or cancelled` : "Known once a project with a budget is closed"}
            />
          </StatGrid>
          <SalariesHiddenNote className="-mt-2" />

          <Section
            title="Budget against actual"
            description="Utilisation is actual expenditure divided by the revised budget. Savings show once a project is completed or cancelled."
            contentClassName="p-0"
          >
            <BudgetTrackingTable rows={rows} />
          </Section>

          <Section title="Stage budgets" description="Stages that have their own budget, against what was spent in that stage." contentClassName={stages.length ? "p-0" : undefined}>
            {stages.length ? (
              <StageBudgetTable rows={stages} />
            ) : (
              <EmptyState
                compact
                icon={Wallet}
                title="No stage budgets set"
                description="Split a project's budget across stages in its Edit form to compare each stage's spend with its own budget."
              />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
