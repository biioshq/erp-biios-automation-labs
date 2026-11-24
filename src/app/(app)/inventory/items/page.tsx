import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { getInventoryCategoryOptions } from "@/server/lookups";
import { inventorySnapshot } from "@/server/services/metrics";
import { getItemSubcategories, getItemVendors, listItems } from "@/features/inventory/items/queries";
import { ITEM_FILTER_KEYS, ITEM_SORT_KEYS } from "@/features/inventory/items/schemas";
import { ItemsView } from "@/features/inventory/items/components/items-view";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "All items" };

export default async function ItemsPage({ searchParams }: PageProps<"/inventory/items">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "inventory.items:view")) return <NoAccess eyebrow="Inventory" title="All items" />;
  const sp = await searchParams;
  const params = parseListParams(sp, {
    filterKeys: ITEM_FILTER_KEYS,
    sortable: ITEM_SORT_KEYS,
    defaultSort: { id: "name", desc: false },
  });
  const layout = sp.layout === "cards" ? "cards" : "table";
  const [data, categories, vendors, subcategories, snapshot] = await Promise.all([
    listItems(params),
    getInventoryCategoryOptions(),
    getItemVendors(),
    getItemSubcategories(),
    inventorySnapshot(),
  ]);

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="All items"
        description={
          <>
            <span className="tabular">{formatNumber(snapshot.items)}</span> items ·{" "}
            <Money value={snapshot.value} className="font-medium text-foreground" /> on hand ·{" "}
            <span className="tabular">{formatNumber(snapshot.lowStock + snapshot.outOfStock)}</span> need restocking
          </>
        }
        actions={
          <>
            {can(user, "inventory.purchase:create") ? (
              <Button variant="outline" asChild>
                <Link href="/inventory/purchase">
                  <PackagePlus /> Purchase stock
                </Link>
              </Button>
            ) : null}
            {can(user, "inventory.items:create") ? (
              <Button asChild>
                <Link href="?new=1" scroll={false}>
                  <Plus /> Add item
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ItemsView data={data} categories={categories} vendors={vendors} subcategories={subcategories} layout={layout} />
    </Page>
  );
}
