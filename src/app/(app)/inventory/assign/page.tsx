import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/shared/page";
import { getLedgerItems, getLedgerProjects, getRecentOperations } from "@/features/inventory/ledger/queries";
import { AssignView } from "@/features/inventory/ledger/components/assign-view";
import { RecentOperations } from "@/features/inventory/ledger/components/recent-operations";

export const metadata: Metadata = { title: "Assign to Project" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AssignStockPage({ searchParams }: PageProps<"/inventory/assign">) {
  const sp = await searchParams;
  const [items, projects, recent] = await Promise.all([getLedgerItems(), getLedgerProjects(), getRecentOperations("assign")]);

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Assign to project"
        description="Move stock from the shelf to a project. The stock is costed at its average price and booked as a project expense under the stage you choose."
      />
      <AssignView
        key={`${one(sp.item) ?? ""}:${one(sp.project) ?? ""}`}
        items={items}
        projects={projects}
        defaultItemId={one(sp.item)}
        defaultProjectId={one(sp.project)}
        recent={<RecentOperations title="Recent assignments" type="assign" operations={recent} emptyText="No stock has been assigned yet. The first assignment shows up here." />}
      />
    </Page>
  );
}
