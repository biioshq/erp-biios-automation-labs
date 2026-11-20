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
import { getItemVendors, listItems } from "@/features/inventory/items/queries";
import { ITEM_FILTER_KEYS, ITEM_SORT_KEYS } from "@/features/inventory/items/schemas";
import { ItemsView } from "@/features/inventory/items/components/items-view";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "All items" };

export default async function ItemsPage({ searchParams }: PageProps<"/inventory/items">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const params = parseListParams(sp, {
    filterKeys: ITEM_FILTER_KEYS,
    sortable: ITEM_SORT_KEYS,
    defaultSort: { id: "name", desc: false },
  });
  const layout = sp.layout === "cards" ? "cards" : "table";
  const [data, categories, vendors, snapshot] = await Promise.all([
    listItems(params),
    getInventoryCategoryOptions(),
    getItemVendors(),
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
            <Button variant="outline" asChild>
              <Link href="/inventory/purchase">
                <PackagePlus /> Purchase stock
              </Link>
            </Button>
            <Button asChild>
              <Link href="?new=1" scroll={false}>
                <Plus /> Add item
              </Link>
            </Button>
          </>
        }
      />
      <ItemsView data={data} categories={categories} vendors={vendors} layout={layout} />
    </Page>
  );
}
