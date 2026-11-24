"use client";

import { startTransition, useEffect, useMemo, useOptimistic, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  LayoutGrid,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Rows3,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, useTableUrl, type FilterDef } from "@/components/data-table";
import { FacetedFilter } from "@/components/data-table/faceted-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useIsAdmin } from "@/components/current-user";
import { Money } from "@/components/shared/money";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { StockLevelBar } from "@/components/shared/stock-level-bar";
import { STOCK_STATUSES } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import { PAGE_SIZES, type Paginated } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { fetchItem, removeItem } from "../actions";
import type { ItemFormRecord, ItemRow } from "../types";
import { ItemForm, type CategoryOption } from "./item-form";
import { ItemCard, OutOfStockHint } from "./item-card";
import { ItemThumb } from "./item-photo";

type Panel = { kind: "new"; from: string | null } | { kind: "edit"; id: string } | null;
type Layout = "table" | "cards";

/**
 * All Inventory: a server-mode table or a card grid (?layout=cards) over the same
 * URL state, with the create / edit sheet driven by ?new=1 and ?edit=<id>.
 * ?new=1&copy=<id> opens Add item filled with another item's details (Duplicate).
 */
export function ItemsView({
  data,
  categories,
  vendors,
  subcategories = [],
  layout,
}: {
  data: Paginated<ItemRow>;
  categories: CategoryOption[];
  vendors: string[];
  /** Subcategories in use, for the filter and the form's suggestions. */
  subcategories?: string[];
  layout: Layout;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, removeRow] = useOptimistic(data.rows, (state, id: string) => state.filter((r) => r.id !== id));
  const [record, setRecord] = useState<ItemFormRecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [template, setTemplate] = useState<ItemFormRecord | null>(null);
  const [removing, setRemoving] = useState<ItemRow | null>(null);
  // Archiving and deleting are admin-only (the action refuses members too).
  const isAdmin = useIsAdmin();

  const panel: Panel = useMemo(() => {
    if (searchParams.get("new") === "1") return { kind: "new", from: searchParams.get("copy") };
    const edit = searchParams.get("edit");
    return edit ? { kind: "edit", id: edit } : null;
  }, [searchParams]);

  const replaceParams = (mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setPanel = (next: Panel) =>
    replaceParams((p) => {
      p.delete("new");
      p.delete("edit");
      p.delete("copy");
      if (next?.kind === "new") {
        p.set("new", "1");
        if (next.from) p.set("copy", next.from);
      }
      if (next?.kind === "edit") p.set("edit", next.id);
    });
  const setLayout = (next: Layout) =>
    replaceParams((p) => {
      if (next === "cards") p.set("layout", "cards");
      else p.delete("layout");
    });

  const editId = panel?.kind === "edit" ? panel.id : null;
  // Closing the sheet (by any path, the back button included) drops the cached copy, so the
  // next open loads the item as it is then instead of reusing an older one.
  const [prevEditId, setPrevEditId] = useState(editId);
  if (editId !== prevEditId) {
    setPrevEditId(editId);
    if (!editId) setRecord(null);
  }
  useEffect(() => {
    if (!editId || record?.id === editId) return;
    let cancelled = false;
    setLoadingRecord(true);
    fetchItem(editId)
      .then((r) => {
        if (cancelled) return;
        if (!r) {
          toast.error("That item no longer exists.");
          setPanel(null);
        }
        setRecord(r);
      })
      .finally(() => !cancelled && setLoadingRecord(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Duplicate: the source item is loaded fresh each time, like the edit form.
  const fromId = panel?.kind === "new" ? panel.from : null;
  const [prevFromId, setPrevFromId] = useState(fromId);
  if (fromId !== prevFromId) {
    setPrevFromId(fromId);
    if (!fromId) setTemplate(null);
  }
  useEffect(() => {
    if (!fromId || template?.id === fromId) return;
    let cancelled = false;
    fetchItem(fromId)
      .then((r) => {
        if (cancelled) return;
        if (!r) {
          toast.error("That item no longer exists. Starting a blank item instead.");
          setPanel({ kind: "new", from: null });
          return;
        }
        setTemplate(r);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Couldn't load that item. Starting a blank item instead.");
        setPanel({ kind: "new", from: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId]);

  async function remove(item: ItemRow) {
    startTransition(() => removeRow(item.id));
    const result = await removeItem({ id: item.id });
    if (!result.ok) {
      toast.error(result.error);
      router.refresh();
      return false;
    }
    toast.success(result.data.archived ? `${item.name} archived` : `${item.name} deleted`);
    emitDataChanged();
    return true;
  }

  const filters: FilterDef[] = useMemo(
    () => [
      { key: "status", title: "Status", options: STOCK_STATUSES.map((s) => ({ ...s })) },
      {
        key: "category",
        title: "Category",
        options: [{ value: "none", label: "Uncategorized" }, ...categories.map((c) => ({ value: c.value, label: c.label }))],
      },
      ...(subcategories.length
        ? [
            {
              key: "subcategory",
              title: "Subcategory",
              options: [{ value: "none", label: "No subcategory" }, ...subcategories.map((s) => ({ value: s, label: s }))],
            },
          ]
        : []),
      { key: "vendor", title: "Vendor", options: vendors.map((v) => ({ value: v, label: v })) },
    ],
    [categories, vendors, subcategories],
  );

  const layoutToggle = (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={layout}
      onValueChange={(v) => v && setLayout(v as Layout)}
      aria-label="Layout"
    >
      <ToggleGroupItem value="table" aria-label="Table layout" className="h-8 px-2.5 max-md:h-10 max-md:px-3">
        <Rows3 />
      </ToggleGroupItem>
      <ToggleGroupItem value="cards" aria-label="Card layout" className="h-8 px-2.5 max-md:h-10 max-md:px-3">
        <LayoutGrid />
      </ToggleGroupItem>
    </ToggleGroup>
  );

  const rowMenu = (item: ItemRow) => (
    <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="font-mono text-xs">{item.sku}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/inventory/items/${item.id}`}>
              <Eye /> View item
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/inventory/purchase?item=${item.id}`}>
              <PackagePlus /> Buy more
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel({ kind: "edit", id: item.id })}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel({ kind: "new", from: item.id })}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(item)}>
                <Archive /> Archive
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const columns = useMemo<ColumnDef<ItemRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        meta: { label: "Item name" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Item name" />,
        cell: ({ row }) => (
          <div className="flex min-w-52 items-center gap-2.5">
            <ItemThumb src={row.original.photoUrl} name={row.original.name} size="xs" />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                <span className="font-mono">{row.original.sku}</span>
                {row.original.variant ? <span> · {row.original.variant}</span> : null}
              </p>
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "category",
        meta: { label: "Category" },
        header: "Category",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="min-w-28 max-w-56">
            {row.original.category ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.category.color }} />
                <span className="truncate">{row.original.category.name}</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Uncategorized</span>
            )}
            {row.original.subcategory ? <p className="truncate pl-4 text-[11px] text-muted-foreground">{row.original.subcategory}</p> : null}
          </div>
        ),
      },
      {
        id: "available",
        accessorKey: "available",
        meta: { label: "Available", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Available" align="right" />,
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular font-semibold",
              row.original.status === "out_of_stock" && "text-danger",
              row.original.status === "low_stock" && "text-warning",
            )}
          >
            {formatNumber(row.original.available)}
          </span>
        ),
      },
      {
        id: "allocated",
        accessorKey: "allocated",
        meta: { label: "In use", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="In use" align="right" />,
        cell: ({ row }) => <span className="tabular text-muted-foreground">{formatNumber(row.original.allocated)}</span>,
      },
      {
        id: "minStock",
        accessorKey: "minStock",
        meta: { label: "Minimum", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Minimum" align="right" />,
        cell: ({ row }) => <span className="tabular text-muted-foreground">{formatNumber(row.original.minStock)}</span>,
      },
      {
        id: "unitPrice",
        accessorKey: "unitPrice",
        meta: { label: "Unit price", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Unit price" align="right" />,
        cell: ({ row }) => <Money value={row.original.unitPrice} />,
      },
      {
        id: "value",
        accessorKey: "value",
        meta: { label: "Value", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Value" align="right" />,
        cell: ({ row }) => <Money value={row.original.value} className="font-semibold" />,
      },
      {
        id: "vendor",
        accessorKey: "vendor",
        meta: { label: "Vendor" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => <span className="block max-w-40 truncate text-muted-foreground">{row.original.vendor ?? "-"}</span>,
      },
      {
        id: "status",
        meta: { label: "Status" },
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-1">
            <StockStatusBadge status={row.original.status} />
            {row.original.status === "out_of_stock" ? <OutOfStockHint /> : null}
          </div>
        ),
      },
      {
        id: "level",
        meta: { label: "Stock level" },
        header: "Stock level",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="w-28">
            <StockLevelBar available={row.original.available} minStock={row.original.minStock} quantity={row.original.quantity} />
          </div>
        ),
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => rowMenu(row.original),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, isAdmin],
  );

  const emptyState = (
    <EmptyState
      icon={PackagePlus}
      title="No inventory items yet"
      description="Add your first item with its opening stock. Every later purchase, assignment and return builds on it."
      action={
        <Button onClick={() => setPanel({ kind: "new", from: null })}>
          <Plus /> Add item
        </Button>
      }
    />
  );

  const sheetOpen = panel !== null;
  const editing = panel?.kind === "edit";

  return (
    <>
      {layout === "table" ? (
        <DataTable
          id="inventory-items"
          mode="server"
          columns={columns}
          data={rows}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          filters={filters}
          searchPlaceholder="Search name, SKU, vendor…"
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/inventory/items/${r.id}`)}
          initialHidden={["minStock", "vendor"]}
          renderMobileRow={(item) => <ItemMobileRow item={item} />}
          toolbarActions={layoutToggle}
          emptyState={emptyState}
        />
      ) : (
        <ItemCardGrid
          rows={rows}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          filters={filters}
          toggle={layoutToggle}
          emptyState={emptyState}
        />
      )}

      <FormSheet
        open={sheetOpen}
        onOpenChange={(o) => !o && setPanel(null)}
        title={editing ? "Edit item" : "Add item"}
        description={
          editing
            ? (record?.sku ?? undefined)
            : fromId
              ? `Starts from ${template?.name ?? "the item"}: its details are filled in, its stock and history are not. Give it a new name.`
              : "Create the item, then record what you hold. Later changes go through Purchase, Assign, Return or Adjust."
        }
      >
        {panel?.kind === "new" && fromId && template?.id !== fromId ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : panel?.kind === "new" ? (
          // Keyed by the source, so switching from a blank form to a duplicate (or between two) starts over.
          <ItemForm
            key={fromId ? `from:${fromId}` : "new"}
            template={fromId ? template : null}
            categories={categories}
            vendors={vendors}
            subcategories={subcategories}
            onDone={() => setPanel(null)}
            onCancel={() => setPanel(null)}
          />
        ) : editing && (loadingRecord || record?.id !== editId) ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : editing && record ? (
          // Keyed by id only: someone else's stock movement bumps updatedAt, and the live refresh
          // that follows must not remount an open form and drop what is being typed. The open form
          // keeps the values it was filled with; updateItem leaves a vendor or purchase date that a
          // purchase changed meanwhile alone unless the user edited that field.
          <ItemForm
            key={record.id}
            item={record}
            categories={categories}
            vendors={vendors}
            subcategories={subcategories}
            onDone={() => {
              setRecord(null);
              setPanel(null);
            }}
            onCancel={() => setPanel(null)}
          />
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={isAdmin && removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Archive ${removing.name}?` : "Archive item?"}
        description="Items with stock history are archived and hidden from lists. Items that were never used are deleted. Items still in stock or assigned to projects cannot be archived."
        confirmLabel="Archive"
        onConfirm={() => (removing ? remove(removing) : false)}
      />
    </>
  );
}

/** One item as a tappable card on phones: name and SKU, status, the three figures and the level bar. */
function ItemMobileRow({ item }: { item: ItemRow }) {
  const tone = item.status === "out_of_stock" ? "text-danger" : item.status === "low_stock" ? "text-warning" : undefined;
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <ItemThumb src={item.photoUrl} name={item.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{item.name}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="truncate font-mono">{item.sku}</span>
            {item.category ? (
              <>
                <span aria-hidden>·</span>
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: item.category.color }} />
                <span className="truncate">{item.category.name}</span>
              </>
            ) : null}
            {item.subcategory ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{item.subcategory}</span>
              </>
            ) : null}
          </p>
          {item.variant ? <p className="truncate text-[11px] text-muted-foreground">{item.variant}</p> : null}
        </div>
        <StockStatusBadge status={item.status} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Available</dt>
          <dd className={cn("tabular text-sm font-semibold", tone)}>{formatNumber(item.available)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">In use</dt>
          <dd className="tabular text-sm font-medium">{formatNumber(item.allocated)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Minimum</dt>
          <dd className="tabular text-sm font-medium">{formatNumber(item.minStock)}</dd>
        </div>
      </dl>
      <StockLevelBar available={item.available} minStock={item.minStock} quantity={item.quantity} />
      {item.status === "out_of_stock" ? <OutOfStockHint /> : null}
    </div>
  );
}

/** Card layout with its own toolbar and pager, reading the same URL state as the table. */
function ItemCardGrid({
  rows,
  total,
  page,
  pageSize,
  filters,
  toggle,
  emptyState,
}: {
  rows: ItemRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: FilterDef[];
  toggle: React.ReactNode;
  emptyState: React.ReactNode;
}) {
  const url = useTableUrl();
  const [search, setSearch] = useState(url.get("q") ?? "");
  useEffect(() => {
    if (search === (url.get("q") ?? "")) return;
    const handle = window.setTimeout(() => url.set({ q: search || null }), 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(search) || filters.some((f) => url.getList(f.key).length > 0);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="h-8 w-full sm:w-64">
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, vendor…" aria-label="Search" />
        </InputGroup>
        {filters.map((f) => (
          <FacetedFilter
            key={f.key}
            title={f.title}
            options={f.options}
            selected={url.getList(f.key)}
            onChange={(values) => url.set({ [f.key]: values.length ? values : null })}
          />
        ))}
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => {
              setSearch("");
              url.set({ q: null, ...Object.fromEntries(filters.map((f) => [f.key, null])) });
            }}
          >
            Reset
          </Button>
        ) : null}
        <div className="ml-auto">{toggle}</div>
      </div>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={Search} title="No matching items" description="Try a different search or clear the filters." />
        ) : (
          emptyState
        )
      ) : (
        <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4", url.isPending && "opacity-60 transition-opacity")}>
          {rows.map((item, i) => (
            <ItemCard key={item.id} item={item} index={i} />
          ))}
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-col-reverse items-center justify-between gap-3 px-1 sm:flex-row">
          <p className="tabular text-xs text-muted-foreground">
            Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
          </p>
          <div className="flex items-center gap-3">
            <select
              aria-label="Items per page"
              value={pageSize}
              onChange={(e) => url.set({ size: e.target.value, page: null })}
              className="h-8 rounded-lg border bg-transparent px-2 text-xs max-md:h-10"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} per page
                </option>
              ))}
            </select>
            <span className="tabular text-xs text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => url.set({ page: page - 1 > 1 ? String(page - 1) : null }, { resetPage: false })}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => url.set({ page: String(page + 1) }, { resetPage: false })}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
