import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Page } from "@/components/shared/page";
import { PROJECT_TABS, type ProjectTab } from "@/features/finance/projects/schemas";
import { getClientNames, getProjectDetail } from "@/features/finance/projects/queries";
import { BudgetTab } from "@/features/finance/projects/components/budget-tab";
import { InventoryTab } from "@/features/finance/projects/components/inventory-tab";
import { OverviewTab } from "@/features/finance/projects/components/overview-tab";
import { ProjectEditSheet } from "@/features/finance/projects/components/project-edit-sheet";
import { ProjectHeader } from "@/features/finance/projects/components/project-header";
import { ProjectTabsNav } from "@/features/finance/projects/components/project-tabs-nav";
import { ProjectTeamTab } from "@/features/employees/components/project-team-tab";
import { TimelineTab } from "@/features/finance/projects/components/timeline-tab";
import { DocumentsTabLoader, ExpensesTabLoader, TabSkeleton } from "./tabs";

export const metadata: Metadata = { title: "Project" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProjectDetailPage({ params, searchParams }: PageProps<"/finance/projects/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const project = await getProjectDetail(id);
  if (!project) notFound();

  const tabRaw = first(sp.tab);
  const tab: ProjectTab = PROJECT_TABS.some((t) => t.value === tabRaw) ? (tabRaw as ProjectTab) : "overview";
  const clients = first(sp.edit) === project.id ? await getClientNames() : [];

  return (
    <Page>
      <ProjectHeader project={project} tab={tab} />
      <ProjectTabsNav tab={tab} />
      <Suspense key={tab} fallback={<TabSkeleton />}>
        {tab === "overview" ? <OverviewTab project={project} /> : null}
        {tab === "budget" ? <BudgetTab project={project} /> : null}
        {tab === "expenses" ? <ExpensesTabLoader project={project} /> : null}
        {tab === "inventory" ? <InventoryTab project={project} /> : null}
        {tab === "team" ? <ProjectTeamTab projectId={project.id} /> : null}
        {tab === "timeline" ? <TimelineTab project={project} /> : null}
        {tab === "documents" ? <DocumentsTabLoader project={project} /> : null}
      </Suspense>
      <ProjectEditSheet project={project} clients={clients} />
    </Page>
  );
}
