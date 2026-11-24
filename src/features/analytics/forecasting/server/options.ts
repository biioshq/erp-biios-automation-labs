import "server-only";

import { getInventoryCategoryOptions, getInventoryItemOptions, getProjectOptions } from "@/server/lookups";
import type { FilterOption } from "../components/forecast-filters";

/** Choices for the material, category and project filters. */
export async function filterOptions(): Promise<{ materials: FilterOption[]; categories: FilterOption[]; projects: FilterOption[] }> {
  const [items, categories, projects] = await Promise.all([getInventoryItemOptions(), getInventoryCategoryOptions(), getProjectOptions()]);
  return {
    materials: items.map((i) => ({ value: i.value, label: i.label, description: i.sku })),
    categories: categories.map((c) => ({ value: c.value, label: c.label })),
    projects: projects.map((p) => ({ value: p.value, label: p.label, description: p.description })),
  };
}
