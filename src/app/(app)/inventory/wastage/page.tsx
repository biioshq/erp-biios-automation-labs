import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, IndianRupee, Receipt, Warehouse } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatNumber } from "@/lib/format";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { getEmployeeOptions, getInventoryItemOptions, getProjectOptions } from "@/server/lookups";
import { requireUser } from "@/server/auth/session";
import { getLedgerItems, getLedgerProjects } from "@/features/inventory/ledger/queries";
import { getStorageLocations, listWastage, wastageToDate } from "@/features/inventory/wastage/queries";
import { WASTAGE_FILTER_KEYS, WASTAGE_SORT_KEYS } from "@/features/inventory/wastage/schemas";
import { WastageForm } from "@/features/inventory/wastage/components/wastage-form";
import { WastageList } from "@/features/inventory/wastage/components/wastage-list";

export const metadata: Metadata = { title: "Record wastage" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Typed by hand: the generated route types only list routes that existed at the last build.
export default async function WastagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const params = parseListParams(sp, { filterKeys: WASTAGE_FILTER_KEYS, sortable: WASTAGE_SORT_KEYS, defaultSort: { id: "date", desc: true } });
  const [items, projects, data, toDate, locations, employees, projectOptions, itemOptions] = await Promise.all([
    getLedgerItems(),
    getLedgerProjects(),
    listWastage(params),
    wastageToDate(),
    getStorageLocations(),
    getEmployeeOptions(),
    getProjectOptions(),
    getInventoryItemOptions(),
  ]);
  const { summary } = data;
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);
  const people = employees.filter((e) => e.status !== "exited").map((e) => e.label);

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Record wastage"
        description={
          <>
            Write off damaged, expired, lost or scrapped stock, from storage or from what a project has in use. Each write-off is valued at cost and shows in{" "}
            <Link href="/finance/assets/inventory" className="font-medium text-foreground underline underline-offset-4">
              Finance, Assets, Inventory
            </Link>
            .
          </>
        }
      />
      <WastageForm
        items={items}
        projects={projects}
        locations={locations}
        people={people}
        defaultItemId={one(sp.item)}
        defaultProjectId={one(sp.project)}
        recent={
          <Section
            title="Wastage records"
            description={filtered ? "Totals for the records in this view" : "Every write-off recorded, newest first"}
            contentClassName="space-y-4"
          >
            <StatGrid>
              <StatCard
                label={filtered ? "Value wasted in view" : "Value wasted, all time"}
                icon={IndianRupee}
                tone="danger"
                value={<Money value={summary.all.value} compact />}
                hint={`${formatNumber(summary.all.count)} write-offs, ${formatNumber(summary.all.units)} units`}
              />
              <StatCard
                label={`Value wasted, ${toDate.fyLabel}`}
                icon={IndianRupee}
                value={<Money value={toDate.financialYear.value} compact />}
                hint={`${formatNumber(toDate.financialYear.count)} write-offs this financial year`}
              />
              <StatCard
                label="From storage"
                icon={Warehouse}
                value={<Money value={summary.storage.value} compact />}
                hint={
                  <>
                    <Money value={summary.expensed} compact /> of it booked as expense now
                  </>
                }
              />
              <StatCard
                label="In use on projects"
                icon={FolderKanban}
                value={<Money value={summary.project.value} compact />}
                hint="Already in project cost"
              />
            </StatGrid>
            <WastageList
              data={data}
              projects={projectOptions.map((p) => ({ value: p.value, label: p.label }))}
              items={itemOptions.map((i) => ({ value: i.value, label: `${i.label} (${i.sku})` }))}
            />
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Receipt className="mt-0.5 size-3.5 shrink-0" />
              Stock that was never expensed (old or opening stock) books its cost as a company expense when it is written off from storage. Stock in use on a project
              was charged to the project when assigned, so wasting it there changes no expense.
            </p>
          </Section>
        }
      />
    </Page>
  );
}
