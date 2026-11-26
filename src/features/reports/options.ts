import "server-only";

import type { FilterOption } from "@/components/data-table/faceted-filter";
import { INCOME_CATEGORIES } from "@/lib/constants";
import { expenseCategoryFilterOptions } from "@/lib/expense-categories";
import { getExpenseCategories } from "@/server/expense-categories";
import { getInventoryCategoryOptions, getProjectOptions, getVendorNames } from "@/server/lookups";
import type { ReportFilterOptions } from "./components/report-filters";
import type { ReportMeta } from "./meta";

/** Option lists for the filters a report shows; the others stay empty so nothing extra is fetched. */
export async function getFilterOptions(meta: ReportMeta | undefined, wantVendors = true): Promise<ReportFilterOptions> {
  const type = meta?.type;
  const needsVendors = wantVendors && (type === "expense" || type === "gst" || type === "ca" || type === "inventory" || type === "daily");
  const [projects, vendors, inventoryCategories, expenseCategories] = await Promise.all([
    getProjectOptions(),
    needsVendors ? getVendorNames() : Promise.resolve([] as string[]),
    meta?.categories === "inventory" ? getInventoryCategoryOptions() : Promise.resolve([]),
    meta?.categories === "expense" ? getExpenseCategories() : Promise.resolve([]),
  ]);
  const categories: FilterOption[] =
    meta?.categories === "expense"
      ? // Hidden ones too: older records still carry them.
        expenseCategoryFilterOptions(expenseCategories)
      : meta?.categories === "income"
        ? INCOME_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))
        : inventoryCategories.map((c) => ({ value: c.value, label: c.label }));
  return {
    projects: [{ value: "none", label: "No project (overhead)" }, ...projects.map((p) => ({ value: p.value, label: p.label }))],
    vendors: vendors.map((v) => ({ value: v, label: v })),
    categories,
  };
}
