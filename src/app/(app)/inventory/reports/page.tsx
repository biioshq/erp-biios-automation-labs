import type { Metadata } from "next";
import { Boxes, IndianRupee, PackageCheck, PackageX } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatNumber, formatPercent } from "@/lib/format";
import { CategoryChart } from "@/features/reports/components/category-chart";
import { DownloadButtons } from "@/features/reports/components/download-buttons";
import { MovementSummary } from "@/features/reports/components/movement-summary";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { ReportPanel } from "@/features/reports/components/report-panel";
import { StatusMix } from "@/features/reports/components/status-mix";
import { metaOf } from "@/features/reports/meta";
import { getFilterOptions } from "@/features/reports/options";
import { getInventoryReportOverview } from "@/features/reports/queries";
import { parseReportFilters } from "@/features/reports/schemas";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Inventory reports" };

export default async function InventoryReportsPage({ searchParams }: PageProps<"/inventory/reports">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const parsed = parseReportFilters(await searchParams);
  const meta = metaOf("inventory")!;
  const [overview, options] = await Promise.all([getInventoryReportOverview(parsed), getFilterOptions(meta, false)]);

  // The valuation is a position as of today: only the category filter applies to it.
  const valuationFilters = { ...parsed, from: null, to: null, project: [], vendor: [], movements: false };
  const attention = overview.status.low_stock + overview.status.out_of_stock;

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Inventory reports"
        description="What the stock on hand is worth, how healthy it is, and what moved in a period."
        actions={<DownloadButtons type="inventory" filters={{ category: parsed.category }} />}
      />

      <StatGrid>
        <StatCard label="Items tracked" value={formatNumber(overview.items)} icon={Boxes} tone="info" hint={`${overview.categories.length} categories`} />
        <StatCard label="On-hand value" value={<Money value={overview.value} compact />} icon={IndianRupee} tone="brand" hint="Available at average cost" />
        <StatCard label="Allocated value" value={<Money value={overview.allocatedValue} compact />} icon={PackageCheck} tone="success" hint="Already a project expense" />
        <StatCard
          label="Needs attention"
          value={formatNumber(attention)}
          icon={PackageX}
          tone={attention ? "warning" : "success"}
          hint={`${overview.status.low_stock} low, ${overview.status.out_of_stock} out of stock`}
        />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Section className="lg:col-span-2" title="Value by category" description="On-hand stock value at weighted average cost.">
          {overview.categories.length === 0 ? (
            <EmptyState compact icon={Boxes} title="No stock to value yet" description="Add items and record a purchase, then the valuation appears here." />
          ) : (
            <div className="space-y-5">
              <CategoryChart categories={overview.categories} />
              <div className="-mx-1 overflow-x-auto rounded-xl border sm:mx-0">
                <table className="w-full min-w-[460px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Category</th>
                      <th className="px-3 py-2.5 text-right font-medium">Items</th>
                      <th className="px-3 py-2.5 text-right font-medium">On-hand value</th>
                      <th className="px-3 py-2.5 text-right font-medium">Share</th>
                      <th className="px-4 py-2.5 text-right font-medium">Allocated value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.categories.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="px-4 py-2.5 font-medium">{c.name}</td>
                        <td className="tabular px-3 py-2.5 text-right text-muted-foreground">{formatNumber(c.items)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Money value={c.value} />
                        </td>
                        <td className="tabular px-3 py-2.5 text-right text-muted-foreground">{overview.value ? formatPercent(c.value / overview.value) : "0%"}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          <Money value={c.allocatedValue} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-4 py-2.5">Total</td>
                      <td className="tabular px-3 py-2.5 text-right">{formatNumber(overview.items)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Money value={overview.value} />
                      </td>
                      <td className="px-3 py-2.5" />
                      <td className="px-4 py-2.5 text-right">
                        <Money value={overview.allocatedValue} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </Section>
        <Section title="Stock status" description="Items by health, from the minimum stock level.">
          <StatusMix counts={overview.status} />
        </Section>
      </div>

      <ReportPanel
        type="inventory"
        title="Valuation report"
        filters={valuationFilters}
        controls={<ReportFilterBar meta={{ type: meta.type, filters: meta.filters, categories: meta.categories }} filters={valuationFilters} options={options} only={["category"]} />}
      />

      <Section title="Stock movements" description="Purchases, assignments, returns and adjustments in the period.">
        <MovementSummary rows={overview.movements} from={parsed.from} to={parsed.to} />
      </Section>
    </Page>
  );
}
