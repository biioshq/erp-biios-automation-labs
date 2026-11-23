import type { Metadata } from "next";
import { FileBarChart } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { financialYearIST, toDateInput } from "@/lib/dates";
import { ExportHistory } from "@/features/reports/components/export-history";
import { ReportCards } from "@/features/reports/components/report-cards";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { ReportPanel } from "@/features/reports/components/report-panel";
import { metaOf, type ReportMeta } from "@/features/reports/meta";
import { getFilterOptions } from "@/features/reports/options";
import { getInventoryReportOverview, listReportHistory } from "@/features/reports/queries";
import { InventoryMovementsSection, InventoryOverview } from "@/features/reports/components/inventory-overview";
import { parseReportFilters, reportQueryString } from "@/features/reports/schemas";
import { canSeeSalaries, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/finance/reports">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const selected = metaOf(typeof sp.report === "string" ? sp.report : undefined);
  const filters = parseReportFilters(sp);
  const isInventory = selected?.type === "inventory";
  const [options, history, seesAll, inventory] = await Promise.all([
    getFilterOptions(selected),
    listReportHistory(20),
    canSeeSalaries(),
    // The inventory report shows its valuation and movement overview on screen too.
    isInventory ? getInventoryReportOverview(filters) : Promise.resolve(null),
  ]);

  const today = toDateInput(new Date());
  const fy = financialYearIST();
  // Switching report keeps the period and project, drops filters that belong to the previous report,
  // and starts a dated report on the current financial year.
  const hrefFor = (m: ReportMeta) => {
    const usesDate = m.filters.includes("date");
    const qs = reportQueryString({
      from: usesDate ? (filters.from ?? toDateInput(fy.start)) : null,
      to: usesDate ? (filters.to ?? today) : null,
      project: m.filters.includes("project") ? filters.project : [],
    });
    return `/finance/reports?report=${m.type}${qs ? `&${qs}` : ""}`;
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Reports and exports"
        description="Build a report, check it on screen, then download it as PDF, Excel or CSV. Figures come from the same records as the rest of Project Manager."
      />
      <ReportCards selected={selected?.type} hrefFor={hrefFor} />
      {inventory ? <InventoryOverview overview={inventory} /> : null}
      {selected ? (
        <ReportPanel
          type={selected.type}
          title={`${selected.label} report`}
          filters={filters}
          controls={<ReportFilterBar meta={{ type: selected.type, filters: selected.filters, categories: selected.categories }} filters={filters} options={options} />}
        />
      ) : (
        <EmptyState
          icon={FileBarChart}
          title="Choose a report"
          description="Pick one of the reports above to set a period, filter it and see a preview before you download."
        />
      )}
      {inventory ? <InventoryMovementsSection overview={inventory} from={filters.from} to={filters.to} /> : null}
      <ExportHistory rows={history} ownOnly={!seesAll} />
    </Page>
  );
}
