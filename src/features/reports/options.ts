import "server-only";

import type { FilterOption } from "@/components/data-table/faceted-filter";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/constants";
import { getInventoryCategoryOptions, getProjectOptions, getVendorNames } from "@/server/lookups";
import type { ReportFilterOptions } from "./components/report-filters";
import type { ReportMeta } from "./meta";

/** Option lists for the filters a report shows; the others stay empty so nothing extra is fetched. */
export async function getFilterOptions(meta: ReportMeta | undefined, wantVendors = true): Promise<ReportFilterOptions> {
  const type = meta?.type;
  const needsVendors = wantVendors && (type === "expense" || type === "gst" || type === "ca" || type === "inventory");
  const [projects, vendors, inventoryCategories] = await Promise.all([
    getProjectOptions(),
    needsVendors ? getVendorNames() : Promise.resolve([] as string[]),
    meta?.categories === "inventory" ? getInventoryCategoryOptions() : Promise.resolve([]),
  ]);
  const categories: FilterOption[] =
    meta?.categories === "expense"
      ? EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))
      : meta?.categories === "income"
        ? INCOME_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))
        : inventoryCategories.map((c) => ({ value: c.value, label: c.label }));
  return {
    projects: [{ value: "none", label: "No project (overhead)" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
    vendors: vendors.map((v) => ({ value: v, label: v })),
    categories,
  };
}
