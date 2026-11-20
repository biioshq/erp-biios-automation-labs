import { getProjectOptions, getVendorNames } from "@/server/lookups";
import { getProjectDocuments, listProjectExpenses } from "@/features/finance/projects/queries";
import { ProjectDocumentsTab } from "@/features/finance/projects/components/documents-tab";
import { ProjectExpensesTab } from "@/features/finance/projects/components/expenses-tab";
import type { ProjectDetail } from "@/features/finance/projects/types";
import { Skeleton } from "@/components/ui/skeleton";
import { getExpenseCategories } from "@/server/expense-categories";

/** Tabs that need a client component with their own data: fetched here so each tab streams on its own. */

export async function ExpensesTabLoader({ project }: { project: ProjectDetail }) {
  const [rows, projects, vendors, categories] = await Promise.all([
    listProjectExpenses(project.id),
    getProjectOptions(),
    getVendorNames(),
    getExpenseCategories(),
  ]);
  return <ProjectExpensesTab projectId={project.id} projectName={project.name} rows={rows} projects={projects} vendors={vendors} categories={categories} />;
}

export async function DocumentsTabLoader({ project }: { project: ProjectDetail }) {
  const { documents, receipts } = await getProjectDocuments(project.id);
  return <ProjectDocumentsTab projectId={project.id} documents={documents} receipts={receipts} />;
}

export function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
