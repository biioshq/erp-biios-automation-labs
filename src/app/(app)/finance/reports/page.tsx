import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileBarChart, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { financialYearIST, toDateInput } from "@/lib/dates";
import { REPORT_TYPES, labelOf } from "@/lib/constants";
import { ExportHistory } from "@/features/reports/components/export-history";
import { ReportCards } from "@/features/reports/components/report-cards";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { ReportPanel } from "@/features/reports/components/report-panel";
import { isLegacyReport, metaOf, type ReportMeta } from "@/features/reports/meta";
import { getFilterOptions } from "@/features/reports/options";
import { getInventoryReportOverview, listReportHistory } from "@/features/reports/queries";
import { InventoryMovementsSection, InventoryOverview } from "@/features/reports/components/inventory-overview";
import { filtersForReport, parseReportFilters, reportQueryString } from "@/features/reports/schemas";
import { canSeeSalaries, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/finance/reports">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const sp = await searchParams;
  const asked = metaOf(typeof sp.report === "string" ? sp.report : undefined);
  // Members never build an admin-only report, even from a shared link.
  const blocked = Boolean(asked?.adminOnly && !isAdmin);
  const selected = blocked ? undefined : asked;
  // The newer reports keep only the filters they offer, as their downloads do; the older ones read the URL as before.
  const parsed = parseReportFilters(sp);
  const filters = selected && !isLegacyReport(selected.type) ? filtersForReport(selected.type, parsed) : parsed;
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
  // and starts a dated report on the current financial year. An as-of report starts on today.
  const hrefFor = (m: ReportMeta) => {
    const usesDate = m.filters.includes("date");
    const qs = reportQueryString({
      from: usesDate ? (filters.from ?? toDateInput(fy.start)) : null,
      to: usesDate ? (filters.to ?? today) : null,
      project: m.filters.includes("project") ? filters.project : [],
      columns: m.filters.includes("columns") ? filters.columns : undefined,
    });
    return `/finance/reports?report=${m.type}${qs ? `&${qs}` : ""}`;
  };
  const pageQuery = selected?.page ? reportQueryString({ from: filters.from, to: filters.to, columns: filters.columns }) : "";

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Reports and exports"
        description="Build a report, check it on screen, then download it as PDF, Excel or CSV. Figures come from the same records as the rest of Project Manager."
      />
      <ReportCards selected={selected?.type} hrefFor={hrefFor} isAdmin={isAdmin} />
      {inventory ? <InventoryOverview overview={inventory} /> : null}
      {selected ? (
        <ReportPanel
          type={selected.type}
          title={isLegacyReport(selected.type) ? `${selected.label} report` : labelOf(REPORT_TYPES, selected.type)}
          filters={filters}
          controls={
            <div className="flex flex-wrap items-start justify-between gap-2">
              <ReportFilterBar meta={{ type: selected.type, filters: selected.filters, categories: selected.categories }} filters={filters} options={options} />
              {selected.page ? (
                <Button asChild variant="ghost" size="sm" className="h-8 max-md:h-10">
                  <Link href={`${selected.page}${pageQuery ? `?${pageQuery}` : ""}`}>
                    Open the statement page <ArrowUpRight />
                  </Link>
                </Button>
              ) : null}
            </div>
          }
        />
      ) : blocked ? (
        <EmptyState
          icon={ShieldCheck}
          title="Only admins can open this report"
          description="Statements, loans, capital and cash figures are for admins. Pick one of the reports above, or ask an admin for this one."
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
