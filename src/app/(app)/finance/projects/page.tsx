import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, Plus, Wallet, PiggyBank, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { valuesOf, PROJECT_STATUSES } from "@/lib/constants";
import { formatNumber, formatPercent } from "@/lib/format";
import { getClientNames, getProjectRow, listProjects } from "@/features/finance/projects/queries";
import { PROJECT_SORTS, type ProjectSort } from "@/features/finance/projects/schemas";
import { ProjectsView } from "@/features/finance/projects/components/projects-view";

export const metadata: Metadata = { title: "Projects" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectsPage({ searchParams }: PageProps<"/finance/projects">) {
  const sp = await searchParams;
  const sortRaw = first(sp.sort);
  const sort = PROJECT_SORTS.some((s) => s.value === sortRaw) ? (sortRaw as ProjectSort) : "newest";
  const statuses = first(sp.status)
    .split(",")
    .filter((s) => (valuesOf(PROJECT_STATUSES) as string[]).includes(s));
  const layout = first(sp.layout) === "table" ? "table" : "grid";
  const editId = first(sp.edit);

  const [{ rows, summary }, clients, editTarget] = await Promise.all([
    listProjects({ q: first(sp.q).slice(0, 100), status: statuses, sort }),
    getClientNames(),
    editId ? getProjectRow(editId) : Promise.resolve(null),
  ]);
  const usage = summary.totalBudget > 0 ? summary.totalSpent / summary.totalBudget : 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Projects"
        description="Budgets, spend and stock for every project. Open one for stage-wise spending, inventory used, a timeline and documents."
        actions={
          <Button asChild>
            <Link href="?new=1" scroll={false}>
              <Plus /> New project
            </Link>
          </Button>
        }
      />
      <StatGrid>
        <StatCard label="Total budget" value={<Money value={summary.totalBudget} compact />} icon={Wallet} tone="info" hint={`Across ${formatNumber(summary.count)} project${summary.count === 1 ? "" : "s"}`} />
        <StatCard label="Total spent" value={<Money value={summary.totalSpent} compact />} icon={Receipt} tone="brand" hint={summary.totalBudget > 0 ? `${formatPercent(usage)} of budget` : undefined} />
        <StatCard
          label="Remaining"
          value={<Money value={summary.remaining} compact tone={summary.remaining < 0 ? "negative" : undefined} />}
          icon={PiggyBank}
          tone={summary.remaining < 0 ? "danger" : "success"}
          hint={summary.remaining < 0 ? "Spend is above the combined budget" : "Budget not yet spent"}
        />
        <StatCard label="Active projects" value={formatNumber(summary.activeCount)} icon={FolderKanban} tone="success" hint={`${formatNumber(summary.count)} in total`} />
      </StatGrid>
      <ProjectsView rows={rows} editTarget={editTarget} clients={clients} layout={layout} hasAny={summary.count > 0} />
    </Page>
  );
}
