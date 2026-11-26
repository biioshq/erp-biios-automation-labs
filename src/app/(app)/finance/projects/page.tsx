import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, CircleCheck, Clock, FolderKanban, HandCoins, Plus, Wallet, PiggyBank, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { valuesOf, PROJECT_STATUSES } from "@/lib/constants";
import { formatNumber, formatPercent } from "@/lib/format";
import { getClientNames, getProjectRow, listProjects } from "@/features/finance/projects/queries";
import { PROJECT_SORTS, type ProjectSort } from "@/features/finance/projects/schemas";
import { ProjectsView } from "@/features/finance/projects/components/projects-view";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Projects" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectsPage({ searchParams }: PageProps<"/finance/projects">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.projects:view")) return <NoAccess title="Projects" />;
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
        description={
          <>
            Value, budgets, income and spend for every project, with what is paid and still owed to vendors. Open one for stage-wise spending, inventory used, a timeline and documents. Compare them on{" "}
            <Link href="/finance/projects/profitability" className="font-medium text-brand-ink hover:underline">
              Profitability
            </Link>{" "}
            and{" "}
            <Link href="/finance/projects/budgets" className="font-medium text-brand-ink hover:underline">
              Budget tracking
            </Link>
            .
          </>
        }
        actions={
          can(user, "finance.projects:create") ? (
            <Button asChild>
              <Link href="?new=1" scroll={false}>
                <Plus /> New project
              </Link>
            </Button>
          ) : undefined
        }
      />
      <StatGrid>
        <StatCard
          label="Total project value"
          value={<Money value={summary.totalContractValue} compact />}
          icon={BadgeIndianRupee}
          tone="success"
          hint={
            summary.withContractValue === summary.count
              ? "Agreed with clients"
              : `${formatNumber(summary.withContractValue)} of ${formatNumber(summary.count)} projects have a value set`
          }
        />
        <StatCard label="Allocated budget" value={<Money value={summary.totalBudget} compact />} icon={Wallet} tone="info" hint={`Across ${formatNumber(summary.count)} project${summary.count === 1 ? "" : "s"}`} />
        <StatCard
          label="Total incurred"
          value={<Money value={summary.totalSpent} compact />}
          icon={Receipt}
          tone="brand"
          hint={summary.totalBudget > 0 ? `${formatPercent(usage)} of budget, paid or not` : "Every expense, paid or not"}
        />
        <StatCard
          label="Remaining"
          value={<Money value={summary.remaining} compact tone={summary.remaining < 0 ? "negative" : undefined} />}
          icon={PiggyBank}
          tone={summary.remaining < 0 ? "danger" : "success"}
          hint={summary.remaining < 0 ? "Spend is above the combined budget" : "Budget minus incurred"}
        />
        <StatCard label="Paid to vendors" value={<Money value={summary.totalPaid} compact />} icon={CircleCheck} tone="success" hint="Part of the incurred total" />
        <StatCard
          label="Outstanding payables"
          value={<Money value={summary.totalPayables} compact />}
          icon={Clock}
          tone={summary.payablesOverdue > 0 ? "danger" : summary.totalPayables > 0 ? "warning" : "success"}
          hint={
            summary.totalPayables <= 0 ? (
              "Nothing owed to vendors"
            ) : summary.payablesOverdue > 0 ? (
              <>
                <Money value={summary.payablesOverdue} compact /> overdue
              </>
            ) : (
              "Still to pay vendors, nothing overdue"
            )
          }
        />
        <StatCard
          label="Payments received"
          value={<Money value={summary.totalReceived} compact />}
          icon={HandCoins}
          tone="success"
          hint={summary.totalOutstanding > 0 ? <><Money value={summary.totalOutstanding} compact /> to receive on invoices</> : "Nothing to receive on invoices"}
        />
        <StatCard label="Active projects" value={formatNumber(summary.activeCount)} icon={FolderKanban} tone="info" hint={`${formatNumber(summary.count)} in total`} />
      </StatGrid>
      <SalariesHiddenNote className="-mt-2" />
      <ProjectsView rows={rows} editTarget={editTarget} clients={clients} layout={layout} hasAny={summary.count > 0} />
    </Page>
  );
}
