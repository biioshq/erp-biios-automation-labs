import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInventoryCategoryOptions, getVendorNames } from "@/server/lookups";
import { getItemDetail } from "@/features/inventory/items/queries";
import { ItemDetailView } from "@/features/inventory/items/components/item-detail";

export async function generateMetadata({ params }: PageProps<"/inventory/items/[id]">): Promise<Metadata> {
  const { id } = await params;
  const item = await getItemDetail(id);
  return { title: item?.name ?? "Item not found" };
}

export default async function ItemPage({ params }: PageProps<"/inventory/items/[id]">) {
  const { id } = await params;
  const [item, categories, vendors] = await Promise.all([getItemDetail(id), getInventoryCategoryOptions(), getVendorNames()]);
  if (!item) notFound();
  return <ItemDetailView item={item} categories={categories} vendors={vendors} />;
}
