import { redirect } from "next/navigation";

/**
 * The inventory report lives under Finance > Reports with the other reports. This address stays
 * so bookmarks and old links still land on it, with their filters.
 */
export default async function InventoryReportsPage({ searchParams }: PageProps<"/inventory/reports">) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "report") continue;
    for (const v of Array.isArray(value) ? value : [value]) if (typeof v === "string") sp.append(key, v);
  }
  const rest = sp.toString();
  redirect(`/finance/reports?report=inventory${rest ? `&${rest}` : ""}`);
}
