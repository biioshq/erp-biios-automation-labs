import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInventoryCategoryOptions, getVendorNames } from "@/server/lookups";
import { getItemDetail, getItemSubcategories } from "@/features/inventory/items/queries";
import { ItemDetailView } from "@/features/inventory/items/components/item-detail";
import { requireUser } from "@/server/auth/session";

export async function generateMetadata({ params }: PageProps<"/inventory/items/[id]">): Promise<Metadata> {
  const { id } = await params;
  const item = await getItemDetail(id);
  return { title: item?.name ?? "Item not found" };
}

export default async function ItemPage({ params }: PageProps<"/inventory/items/[id]">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const { id } = await params;
  const [item, categories, vendors, subcategories] = await Promise.all([
    getItemDetail(id),
    getInventoryCategoryOptions(),
    getVendorNames(),
    getItemSubcategories(),
  ]);
  if (!item) notFound();
  return <ItemDetailView item={item} categories={categories} vendors={vendors} subcategories={subcategories} />;
}
