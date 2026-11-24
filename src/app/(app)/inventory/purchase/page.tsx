import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/shared/page";
import { getVendorNames } from "@/server/lookups";
import { getLastPurchases, getLedgerItems, getRecentOperations } from "@/features/inventory/ledger/queries";
import { PurchaseView } from "@/features/inventory/ledger/components/purchase-view";
import { RecentOperations } from "@/features/inventory/ledger/components/recent-operations";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "Purchase Stock" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PurchaseStockPage({ searchParams }: PageProps<"/inventory/purchase">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "inventory.purchase:view")) return <NoAccess eyebrow="Inventory" title="Purchase stock" />;
  const sp = await searchParams;
  const [items, vendors, recent, lastPurchases] = await Promise.all([
    getLedgerItems(),
    getVendorNames(),
    getRecentOperations("purchase"),
    getLastPurchases(),
  ]);
  const quantity = Number(one(sp.quantity));

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Purchase stock"
        description="Record stock you bought. Quantity goes into available stock and the average cost is updated. A GST invoice adds to your input credit."
      />
      <PurchaseView
        key={`${one(sp.item) ?? ""}:${one(sp.quantity) ?? ""}`}
        items={items}
        lastPurchases={lastPurchases}
        vendors={vendors}
        defaultItemId={one(sp.item)}
        defaultQuantity={Number.isFinite(quantity) && quantity > 0 ? quantity : undefined}
        recent={<RecentOperations title="Recent purchases" type="purchase" operations={recent} emptyText="No purchases yet. The first one you record shows up here." />}
      />
    </Page>
  );
}
