import { Boxes, IndianRupee, PackageCheck, PackageX } from "lucide-react";
import { Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatNumber, formatPercent } from "@/lib/format";
import { CategoryChart } from "./category-chart";
import { MovementSummary } from "./movement-summary";
import { StatusMix } from "./status-mix";
import type { InventoryReportOverview } from "../queries";

/**
 * The inventory report's on-screen overview (Finance > Reports > Inventory): value by category,
 * stock health and the movement totals. The valuation is a position as of today.
 */
export function InventoryOverview({ overview }: { overview: InventoryReportOverview }) {
  const attention = overview.status.low_stock + overview.status.out_of_stock;
  return (
    <>
      <StatGrid>
        <StatCard label="Items tracked" value={formatNumber(overview.items)} icon={Boxes} tone="info" hint={`${overview.categories.length} categories`} />
        <StatCard label="On-hand value" value={<Money value={overview.value} compact />} icon={IndianRupee} tone="brand" hint="Available at average cost" />
        <StatCard
          label="Allocated value"
          value={<Money value={overview.allocatedValue} compact />}
          icon={PackageCheck}
          tone="success"
          hint="Already a project expense"
        />
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
                        <td className="tabular px-3 py-2.5 text-right text-muted-foreground">
                          {overview.value ? formatPercent(c.value / overview.value) : "0%"}
                        </td>
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
    </>
  );
}

/** Purchases, assignments, returns and adjustments in the period, under the report panel. */
export function InventoryMovementsSection({ overview, from, to }: { overview: InventoryReportOverview; from: string | null; to: string | null }) {
  return (
    <Section title="Stock movements" description="Purchases, assignments, returns and adjustments in the period.">
      <MovementSummary rows={overview.movements} from={from} to={to} />
    </Section>
  );
}
