import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/shared/page";
import { getLedgerItems, getLedgerProjects, getRecentOperations } from "@/features/inventory/ledger/queries";
import { ReturnView } from "@/features/inventory/ledger/components/return-view";
import { RecentOperations } from "@/features/inventory/ledger/components/recent-operations";

export const metadata: Metadata = { title: "Return from Project" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ReturnStockPage({ searchParams }: PageProps<"/inventory/return">) {
  const sp = await searchParams;
  const [items, projects, recent] = await Promise.all([getLedgerItems(), getLedgerProjects(), getRecentOperations("return")]);

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Return from project"
        description="Take unused stock back from a project. Its spend goes down by the cost the stock was assigned at, latest assignments first."
      />
      <ReturnView
        key={`${one(sp.item) ?? ""}:${one(sp.project) ?? ""}`}
        items={items}
        projects={projects}
        defaultProjectId={one(sp.project)}
        defaultItemId={one(sp.item)}
        recent={<RecentOperations title="Recent returns" type="return" operations={recent} emptyText="No stock has been returned yet. The first return shows up here." />}
      />
    </Page>
  );
}
