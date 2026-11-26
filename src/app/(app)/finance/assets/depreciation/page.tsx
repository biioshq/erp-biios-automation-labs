import { redirect } from "next/navigation";
import type { SearchParams } from "@/lib/list-params";

/**
 * The old combined summary. Depreciation now sits inside Fixed assets and amortization inside
 * Intangible assets; old links and bookmarks land on the matching page with their period kept.
 */
export default async function OldDepreciationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const kind = Array.isArray(sp.kind) ? sp.kind[0] : sp.kind;
  const keep = new URLSearchParams();
  for (const key of ["fy", "from", "to"]) {
    const v = sp[key];
    const value = Array.isArray(v) ? v[0] : v;
    if (value) keep.set(key, value);
  }
  const qs = keep.toString();
  const base = kind === "intangible" ? "/finance/assets/intangible/amortization" : "/finance/assets/fixed/depreciation";
  redirect(qs ? `${base}?${qs}` : base);
}
