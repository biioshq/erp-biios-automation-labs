"use client";

import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, EyeOff, Search, Settings2, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { RowsPerPage } from "./rows-per-page";
import { formatNumber } from "@/lib/format";
import { FacetedFilter, type FilterDef } from "./faceted-filter";
import { DateRangeFilter } from "./date-range-filter";
import { useTableUrl } from "./use-table-url";

export type { FilterDef } from "./faceted-filter";

/** Column meta: `align: "right"` for numbers, `className` for cells, `label` for the column menu. */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "left" | "right" | "center";
    className?: string;
    headerClassName?: string;
    label?: string;
  }
}

type CommonProps<TData> = {
  /** Unique per table: column visibility is remembered under this id. */
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  searchPlaceholder?: string;
  /** Multi-select filters. In server mode their keys are URL params; in client mode, column ids. */
  filters?: FilterDef[];
  /** Show a date-range filter (URL ?from&to in server mode). */
  dateRange?: boolean | { label?: string };
  /** Buttons on the right of the toolbar (export, add). */
  toolbarActions?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData) => string;
  /** Shown when there is no data at all (no filters active). */
  emptyState?: React.ReactNode;
  /** Columns hidden until the user shows them. */
  initialHidden?: string[];
  rowClassName?: (row: TData) => string | undefined;
  className?: string;
  hideToolbar?: boolean;
  /**
   * Phones: render each row as a card instead of table columns (below the md breakpoint).
   * Return the card's content; the DataTable adds the tap target, spacing and dividers.
   */
  renderMobileRow?: (row: TData) => React.ReactNode;
};

type ServerProps = {
  /** Server mode: `data` is one page and `total` the full count; the URL drives everything. */
  mode: "server";
  total: number;
  page: number;
  pageSize: number;
};

type ClientProps = { mode?: "client"; pageSize?: number };

export type DataTableProps<TData> = CommonProps<TData> & (ServerProps | ClientProps);

function useColumnVisibility(id: string, initialHidden: string[] = []) {
  const storageKey = `dt:${id}:columns`;
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(initialHidden.map((c) => [c, false])),
  );
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setVisibility((v) => ({ ...v, ...JSON.parse(saved) }));
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, [storageKey]);
  const update = (next: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
    setVisibility((old) => {
      const value = typeof next === "function" ? next(old) : next;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        /* ignore */
      }
      return value;
    });
  };
  return [visibility, update] as const;
}

/**
 * The ERP's table: search, faceted filters, date range, sorting, pagination
 * and column visibility, with a dimmed body while the next page loads.
 *
 * Server mode (lists that grow: expenses, income, movements, tasks):
 *   <DataTable mode="server" id="expenses" columns={columns} data={page.rows} total={page.total}
 *              page={page.page} pageSize={page.pageSize} filters={[...]} dateRange />
 *   Column ids must match the sort keys the server query accepts.
 *
 * Client mode (small, already-loaded lists: categories, a project's documents):
 *   <DataTable id="categories" columns={columns} data={rows} />
 */
export function DataTable<TData>(props: DataTableProps<TData>) {
  const {
    id,
    columns,
    data,
    searchPlaceholder = "Search…",
    filters = [],
    dateRange,
    toolbarActions,
    onRowClick,
    getRowId,
    emptyState,
    initialHidden,
    rowClassName,
    className,
    hideToolbar,
    renderMobileRow,
  } = props;
  const server = props.mode === "server";
  const url = useTableUrl();
  const [columnVisibility, setColumnVisibility] = useColumnVisibility(id, initialHidden);

  // Client-mode state.
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: !server ? (props.pageSize ?? 10) : 20,
  });

  // Server-mode state comes from the URL.
  const urlSort = url.get("sort");
  const serverSorting: SortingState = useMemo(() => {
    if (!urlSort) return [];
    const [sid, dir] = urlSort.split(".");
    return sid ? [{ id: sid, desc: dir === "desc" }] : [];
  }, [urlSort]);

  const [search, setSearch] = useState(server ? (url.get("q") ?? "") : "");
  useEffect(() => {
    if (!server) return;
    const current = url.get("q") ?? "";
    if (search === current) return;
    const handle = window.setTimeout(() => url.set({ q: search || null }), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, server]);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: server
      ? {
          sorting: serverSorting,
          columnVisibility,
          pagination: { pageIndex: props.page - 1, pageSize: props.pageSize },
        }
      : { sorting, columnVisibility, globalFilter, columnFilters, pagination },
    manualPagination: server,
    manualSorting: server,
    manualFiltering: server,
    pageCount: server ? Math.max(1, Math.ceil(props.total / props.pageSize)) : undefined,
    enableSortingRemoval: true,
    onSortingChange: (updater) => {
      if (!server) {
        setSorting(updater);
        return setPagination((p) => ({ ...p, pageIndex: 0 }));
      }
      const next = typeof updater === "function" ? updater(serverSorting) : updater;
      const s = next[0];
      url.set({ sort: s ? `${s.id}.${s.desc ? "desc" : "asc"}` : null });
    },
    onColumnVisibilityChange: setColumnVisibility,
    // Client mode: a new search or filter starts from page 1. (Not on every data change: live
    // updates re-render with fresh rows, and that must not throw the reader back to page 1.)
    onGlobalFilterChange: (updater) => {
      setGlobalFilter(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onPaginationChange: (updater) => {
      if (!server) return setPagination(updater);
      const current = { pageIndex: props.page - 1, pageSize: props.pageSize };
      const next = typeof updater === "function" ? updater(current) : updater;
      if (next.pageSize !== current.pageSize) url.set({ size: String(next.pageSize), page: null });
      else url.set({ page: next.pageIndex > 0 ? String(next.pageIndex + 1) : null }, { resetPage: false });
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: server ? undefined : getSortedRowModel(),
    getFilteredRowModel: server ? undefined : getFilteredRowModel(),
    getPaginationRowModel: server ? undefined : getPaginationRowModel(),
    getFacetedUniqueValues: server ? undefined : getFacetedUniqueValues(),
    globalFilterFn: "includesString",
    autoResetPageIndex: false,
  });

  // When rows disappear (deleted elsewhere), stay on the last page that still exists.
  const lastPage = server ? 0 : Math.max(0, table.getPageCount() - 1);
  useEffect(() => {
    if (!server && pagination.pageIndex > lastPage) setPagination((p) => ({ ...p, pageIndex: lastPage }));
  }, [server, lastPage, pagination.pageIndex]);

  // Filter values and setters for both modes.
  const filterValue = (key: string): string[] =>
    server ? url.getList(key) : ((table.getColumn(key)?.getFilterValue() as string[] | undefined) ?? []);
  const setFilterValue = (key: string, values: string[]) => {
    if (server) url.set({ [key]: values.length ? values : null });
    else table.getColumn(key)?.setFilterValue(values.length ? values : undefined);
  };

  const from = server ? url.get("from") : null;
  const to = server ? url.get("to") : null;
  const searchValue = server ? search : globalFilter;
  const isFiltered = Boolean(searchValue) || filters.some((f) => filterValue(f.key).length > 0) || Boolean(from || to);
  const total = server ? props.total : table.getFilteredRowModel().rows.length;
  const rows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns().length;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageCount = Math.max(1, table.getPageCount());
  const firstRow = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min(total, (pageIndex + 1) * pageSize);

  const resetFilters = () => {
    if (server) {
      setSearch("");
      url.set({ q: null, from: null, to: null, ...Object.fromEntries(filters.map((f) => [f.key, null])) });
    } else {
      setGlobalFilter("");
      setColumnFilters([]);
    }
  };

  const columnsMenu = (iconOnly: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={iconOnly ? "icon" : "sm"} className={iconOnly ? undefined : "h-8"} aria-label="Choose columns">
          <Settings2 className="opacity-70" />
          {iconOnly ? null : "Columns"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllLeafColumns()
          .filter((c) => c.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(v) => column.toggleVisibility(Boolean(v))}
              onSelect={(e) => e.preventDefault()}
            >
              {column.columnDef.meta?.label ??
                (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id)}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const showEmptyState = !isFiltered && total === 0 && emptyState;
  const hiddenColumns = table.getAllLeafColumns().filter((c) => c.getCanHide() && !c.getIsVisible());
  const columnName = (c: (typeof hiddenColumns)[number]) =>
    c.columnDef.meta?.label ?? (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {!hideToolbar ? (
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {/* Phones: full-width search with the column menu beside it. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <InputGroup className="h-10 min-w-0 flex-1 sm:h-8 sm:w-64 sm:flex-none">
                <InputGroupAddon>
                  <Search className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  value={searchValue}
                  onChange={(e) => (server ? setSearch(e.target.value) : setGlobalFilter(e.target.value))}
                  placeholder={searchPlaceholder}
                  aria-label="Search"
                />
              </InputGroup>
              <div className="sm:hidden">{columnsMenu(true)}</div>
            </div>
            {/* Phones: filter chips in one horizontally scrollable row. From sm they wrap as before. */}
            {filters.length > 0 || dateRange || isFiltered ? (
              <div
                className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] max-sm:[&>*]:shrink-0 sm:contents [&::-webkit-scrollbar]:hidden"
                data-slot="table-filters"
              >
                {filters.map((f) => (
                  <FacetedFilter
                    key={f.key}
                    title={f.title}
                    options={f.options}
                    selected={filterValue(f.key)}
                    onChange={(values) => setFilterValue(f.key, values)}
                  />
                ))}
                {dateRange && server ? (
                  <DateRangeFilter
                    from={from}
                    to={to}
                    label={typeof dateRange === "object" ? dateRange.label : undefined}
                    onChange={(r) => url.set({ from: r.from, to: r.to })}
                  />
                ) : null}
                {isFiltered ? (
                  <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 px-2 max-md:h-10">
                    Reset <X />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={cn("flex flex-wrap items-center gap-2", !toolbarActions && "max-sm:hidden")}>
            <div className="hidden sm:block">{columnsMenu(false)}</div>
            {toolbarActions}
          </div>
        </div>
      ) : null}

      {hiddenColumns.length && !showEmptyState ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground" data-slot="hidden-columns">
          <EyeOff className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {hiddenColumns.length === 1 ? "1 column hidden" : `${hiddenColumns.length} columns hidden`}: {hiddenColumns.map(columnName).join(", ")}
          </span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => hiddenColumns.forEach((c) => c.toggleVisibility(true))}>
            Show all
          </Button>
        </div>
      ) : null}

      {showEmptyState ? (
        emptyState
      ) : (
        <>
        {renderMobileRow ? (
          <div
            className={cn(
              "relative divide-y divide-border overflow-hidden rounded-xl border bg-card shadow-card transition-opacity md:hidden",
              url.isPending && "opacity-50",
            )}
          >
            {rows.length ? (
              rows.map((row) =>
                onRowClick ? (
                  // Not a <button>: cards may hold their own buttons (an actions menu), and a button
                  // inside a button is invalid HTML that breaks hydration. Taps on those inner
                  // controls belong to them, not to the card.
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      const inner = (e.target as HTMLElement).closest("button, a, input, select, textarea, label, [role=menuitem]");
                      if (inner && inner !== e.currentTarget && e.currentTarget.contains(inner)) return;
                      onRowClick(row.original);
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                      e.preventDefault();
                      onRowClick(row.original);
                    }}
                    className={cn(
                      "flex min-h-14 w-full cursor-pointer items-center gap-2 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/40 active:bg-muted/70 focus-visible:bg-muted/60",
                      rowClassName?.(row.original),
                    )}
                  >
                    <div className="min-w-0 flex-1">{renderMobileRow(row.original)}</div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
                  </div>
                ) : (
                  <div key={row.id} className={cn("min-w-0 px-4 py-3", rowClassName?.(row.original))}>
                    {renderMobileRow(row.original)}
                  </div>
                ),
              )
            ) : (
              <EmptyState
                compact
                icon={Search}
                title="No matching results"
                description="Try a different search or clear the filters."
                className="border-0"
                action={
                  isFiltered ? (
                    <Button variant="outline" size="sm" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        ) : null}
        <div className={cn("relative overflow-hidden rounded-xl border bg-card shadow-card", renderMobileRow && "hidden md:block")}>
          {url.isPending ? (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden>
              <div className="h-full w-1/3 animate-[dt-loading_1s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-brand to-transparent" />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40 [&_tr]:border-b">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="hover:bg-transparent">
                    {hg.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{ width: header.column.columnDef.size !== 150 ? header.column.columnDef.size : undefined }}
                        className={cn(
                          "h-10 px-3 text-xs whitespace-nowrap first:pl-4 last:pr-4",
                          header.column.columnDef.meta?.align === "right" && "text-right",
                          header.column.columnDef.meta?.align === "center" && "text-center",
                          header.column.columnDef.meta?.headerClassName,
                        )}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className={cn("transition-opacity duration-200", url.isPending && "opacity-50")}>
                {rows.length ? (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row.original);
                            }
                          : undefined
                      }
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn(
                        "group/row animate-in fade-in-0 duration-300",
                        onRowClick && "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none",
                        rowClassName?.(row.original),
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "px-3 py-2.5 first:pl-4 last:pr-4",
                            cell.column.columnDef.meta?.align === "right" && "text-right",
                            cell.column.columnDef.meta?.align === "center" && "text-center",
                            cell.column.columnDef.meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={visibleColumns} className="p-6">
                      <EmptyState
                        compact
                        icon={Search}
                        title="No matching results"
                        description="Try a different search or clear the filters."
                        className="border-0"
                        action={
                          isFiltered ? (
                            <Button variant="outline" size="sm" onClick={resetFilters}>
                              Clear filters
                            </Button>
                          ) : undefined
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        </>
      )}

      {!showEmptyState ? (
        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular text-center text-xs text-muted-foreground sm:text-left">
            {total === 0 ? "No results" : `Showing ${formatNumber(firstRow)}–${formatNumber(lastRow)} of ${formatNumber(total)}`}
          </p>
          <div className="flex items-center justify-between sm:justify-end sm:gap-4">
            <RowsPerPage className="hidden sm:flex" value={pageSize} onChange={(n) => table.setPageSize(n ?? pageSize)} />
            <span className="tabular text-xs text-muted-foreground max-sm:order-2 max-sm:flex-1 max-sm:text-center">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <div className="contents sm:flex sm:items-center sm:gap-1">
              <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()} aria-label="First page">
                <ChevronsLeft />
              </Button>
              <Button variant="outline" size="icon-sm" className="max-sm:order-1" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" className="max-sm:order-3" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
                <ChevronRight />
              </Button>
              <Button variant="outline" size="icon-sm" className="hidden sm:inline-flex" onClick={() => table.setPageIndex(pageCount - 1)} disabled={!table.getCanNextPage()} aria-label="Last page">
                <ChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
