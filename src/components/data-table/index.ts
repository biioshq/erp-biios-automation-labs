import type { FilterFn } from "@tanstack/react-table";

export { DataTable, type DataTableProps, type FilterDef } from "./data-table";
export { DataTableColumnHeader } from "./column-header";
export { DataTableSkeleton, PageSkeleton } from "./table-skeleton";
export { DateRangeFilter } from "./date-range-filter";
export { useTableUrl } from "./use-table-url";

/** Client-mode facet filter: matches when the cell value is one of the selected values. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const facetFilterFn: FilterFn<any> = (row, id, value: string[]) =>
  !value?.length || value.includes(String(row.getValue(id)));
