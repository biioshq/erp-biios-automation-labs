import type { Metadata } from "next";
import { ArrowDownToLine, ArrowUpFromLine, PackagePlus, SlidersHorizontal } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { getInventoryItemOptions, getProjectOptions } from "@/server/lookups";
import { listMovements } from "@/features/inventory/movements/queries";
import { MOVEMENT_FILTER_KEYS, MOVEMENT_SORT_KEYS } from "@/features/inventory/movements/schemas";
import { MovementsView } from "@/features/inventory/movements/components/movements-view";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Stock Movement" };

export default async function MovementsPage({ searchParams }: PageProps<"/inventory/movements">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const params = parseListParams(await searchParams, {
    filterKeys: MOVEMENT_FILTER_KEYS,
    sortable: MOVEMENT_SORT_KEYS,
    defaultSort: { id: "date", desc: true },
  });
  const [data, projects, items] = await Promise.all([listMovements(params), getProjectOptions(), getInventoryItemOptions()]);
  const { summary } = data;
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);
  const net = summary.adjustment.net;

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Stock movement"
        description={
          <>
            <span className="tabular">{formatNumber(summary.count)}</span> movements{filtered ? " in this view" : " recorded"}. Every change to stock, with the balance it left behind.
          </>
        }
      />
      <StatGrid>
        <StatCard
          label="Purchased"
          icon={PackagePlus}
          tone="success"
          value={formatNumber(summary.purchase.units)}
          hint={
            <>
              <Money value={summary.purchase.value} compact /> across {formatNumber(summary.purchase.count)} purchases
            </>
          }
        />
        <StatCard
          label="Assigned to projects"
          icon={ArrowUpFromLine}
          tone="brand"
          value={formatNumber(summary.assign.units)}
          hint={
            <>
              <Money value={summary.assign.value} compact /> across {formatNumber(summary.assign.count)} assignments
            </>
          }
        />
        <StatCard
          label="Returned"
          icon={ArrowDownToLine}
          tone="info"
          value={formatNumber(summary.return.units)}
          hint={
            <>
              <Money value={summary.return.value} compact /> across {formatNumber(summary.return.count)} returns
            </>
          }
        />
        <StatCard
          label="Adjusted"
          icon={SlidersHorizontal}
          value={`${net > 0 ? "+" : ""}${formatNumber(net)}`}
          hint={`${formatNumber(summary.adjustment.count)} adjustments, net units`}
        />
      </StatGrid>
      <MovementsView
        data={data}
        projects={projects.map((p) => ({ value: p.value, label: p.label }))}
        items={items.map((i) => ({ value: i.value, label: `${i.label} (${i.sku})` }))}
      />
    </Page>
  );
}
