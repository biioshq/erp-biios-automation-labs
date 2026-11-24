import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/shared/page";
import { getLedgerItems, getLedgerProjects, getRecentOperations } from "@/features/inventory/ledger/queries";
import { AssignView } from "@/features/inventory/ledger/components/assign-view";
import { RecentOperations } from "@/features/inventory/ledger/components/recent-operations";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "Assign to Project" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AssignStockPage({ searchParams }: PageProps<"/inventory/assign">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "inventory.movement:view")) return <NoAccess eyebrow="Inventory" title="Assign to project" />;
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
