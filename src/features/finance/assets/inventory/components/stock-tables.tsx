"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes, PackageOpen, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, DataTableColumnHeader, facetFilterFn } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { ProjectStatusBadge, StatusBadge, StockStatusBadge } from "@/components/shared/status-badge";
import { INVENTORY_UNITS, PROJECT_STAGES, labelOf, type InventoryUnit } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { InUseRow, StorageRow, WastedRow } from "../types";

export type StockTab = "storage" | "in-use" | "wasted";
const TABS: StockTab[] = ["storage", "in-use", "wasted"];

const day = (d: string | null) => (d ? formatDate(fromDateInput(d)) : "Not recorded");
const unitLabel = (u: string) => labelOf(INVENTORY_UNITS, u as InventoryUnit).toLowerCase();
const qty = (n: number, unit: string) => `${formatNumber(n)} ${unitLabel(unit)}`;

function ItemCell({ id, name, sku, category }: { id: string; name: string; sku: string; category: string | null }) {
  return (
    <div className="min-w-44 max-w-64">
      <Link href={`/inventory/items/${id}`} className="block truncate font-medium hover:underline">
        {name}
      </Link>
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-mono">{sku}</span>
        {category ? ` · ${category}` : ""}
      </p>
    </div>
  );
}

/** A right-aligned, sortable money column. */
function moneyCol<T>(id: string, title: string, value: (r: T) => number, cell: (r: T) => React.ReactNode, hideable = true): ColumnDef<T> {
  return {
    id,
    accessorFn: value,
    meta: { label: title, align: "right" },
    header: ({ column }) => <DataTableColumnHeader column={column} title={title} align="right" />,
    cell: ({ row }) => cell(row.original),
    enableHiding: hideable,
  };
}

function StorageTable({ rows }: { rows: StorageRow[] }) {
  const columns = useMemo<ColumnDef<StorageRow>[]>(
    () => [
      { id: "name", accessorFn: (r) => `${r.name} ${r.sku}`, meta: { label: "Item" }, header: "Item", enableHiding: false, cell: ({ row }) => <ItemCell {...row.original} /> },
      {
        id: "quantity",
        accessorKey: "quantity",
        meta: { label: "Quantity", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quantity" align="right" />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{qty(row.original.quantity, row.original.unit)}</span>,
      },
      moneyCol<StorageRow>("unitPrice", "Cost per unit", (r) => r.unitPrice, (r) => <Money value={r.unitPrice} exact />),
      moneyCol<StorageRow>("value", "Stock value", (r) => r.value, (r) => <Money value={r.value} className="font-semibold" />, false),
      { id: "location", accessorFn: (r) => r.location ?? "", meta: { label: "Location" }, header: "Location", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{row.original.location ?? "Not set"}</span> },
      {
        id: "lastIn",
        accessorFn: (r) => r.lastIn ?? "",
        meta: { label: "Last stock in" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last stock in" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{day(row.original.lastIn)}</span>,
      },
      { id: "status", accessorKey: "status", meta: { label: "Status" }, header: "Status", enableSorting: false, filterFn: facetFilterFn, cell: ({ row }) => <StockStatusBadge status={row.original.status} /> },
    ],
    [],
  );
  return (
    <DataTable
      id="valuation-storage"
      columns={columns}
      data={rows}
      pageSize={20}
      searchPlaceholder="Search item or SKU…"
      filters={[{ key: "status", title: "Status", options: [{ value: "in_stock", label: "In Stock" }, { value: "low_stock", label: "Low Stock" }] }]}
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/inventory/items/${r.id}`} className="min-w-0 flex-1 truncate font-medium">
              {r.name}
            </Link>
            <Money value={r.value} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.sku}</span> · {qty(r.quantity, r.unit)} at <Money value={r.unitPrice} exact /> · {r.location ?? "no location"}
          </p>
          <StockStatusBadge status={r.status} />
        </div>
      )}
      emptyState={<EmptyState compact icon={Boxes} title="Nothing in storage" description="Stock bought or returned from projects shows here, valued at its average cost." />}
    />
  );
}

function InUseTable({ rows }: { rows: InUseRow[] }) {
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.project) seen.set(r.project.id, r.project.name);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);
  const columns = useMemo<ColumnDef<InUseRow>[]>(
    () => [
      { id: "name", accessorFn: (r) => `${r.name} ${r.sku}`, meta: { label: "Item" }, header: "Item", enableHiding: false, cell: ({ row }) => <ItemCell {...row.original} id={row.original.itemId} /> },
      {
        id: "project",
        accessorFn: (r) => r.project?.id ?? "",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        filterFn: facetFilterFn,
        cell: ({ row }) =>
          row.original.project ? (
            <div className="min-w-36">
              <Link href={`/finance/projects/${row.original.project.id}`} className="flex items-center gap-1.5 truncate text-sm hover:underline">
                <span className="size-2 shrink-0 rounded-full" style={{ background: row.original.project.color }} />
                {row.original.project.name}
              </Link>
              {row.original.stage ? <p className="text-xs text-muted-foreground">{labelOf(PROJECT_STAGES, row.original.stage)}</p> : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Deleted project</span>
          ),
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        meta: { label: "In use", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="In use" align="right" />,
        cell: ({ row }) => (
          <div className="text-right">
            <span className="tabular whitespace-nowrap">{qty(row.original.quantity, row.original.unit)}</span>
            {row.original.wasted > 0 ? <p className="text-[11px] text-danger">{formatNumber(row.original.wasted)} wasted</p> : null}
          </div>
        ),
      },
      moneyCol<InUseRow>("unitCost", "Cost per unit", (r) => r.unitCost, (r) => <Money value={r.unitCost} exact />),
      moneyCol<InUseRow>("value", "Value in use", (r) => r.value, (r) => <Money value={r.value} className="font-semibold" />, false),
      {
        id: "assignedAt",
        accessorKey: "assignedAt",
        meta: { label: "Issued on" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Issued on" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{day(row.original.assignedAt)}</span>,
      },
      {
        id: "status",
        meta: { label: "Project status" },
        header: "Project status",
        enableSorting: false,
        cell: ({ row }) => (row.original.project ? <ProjectStatusBadge status={row.original.project.status} /> : null),
      },
    ],
    [],
  );
  return (
    <DataTable
      id="valuation-in-use"
      columns={columns}
      data={rows}
      pageSize={20}
      searchPlaceholder="Search item or SKU…"
      filters={projectOptions.length > 1 ? [{ key: "project", title: "Project", options: projectOptions }] : []}
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/inventory/items/${r.itemId}`} className="min-w-0 flex-1 truncate font-medium">
              {r.name}
            </Link>
            <Money value={r.value} className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {qty(r.quantity, r.unit)} on {r.project?.name ?? "a deleted project"} · issued {day(r.assignedAt)}
          </p>
        </div>
      )}
      emptyState={<EmptyState compact icon={PackageOpen} title="No stock in use on projects" description="Stock assigned to projects and not returned shows here, at the cost it was issued at." />}
    />
  );
}

function WastedTable({ rows }: { rows: WastedRow[] }) {
  const columns = useMemo<ColumnDef<WastedRow>[]>(
    () => [
      { id: "name", accessorFn: (r) => `${r.name} ${r.sku}`, meta: { label: "Item" }, header: "Item", enableHiding: false, cell: ({ row }) => <ItemCell {...row.original} id={row.original.itemId} /> },
      {
        id: "reason",
        accessorKey: "reason",
        meta: { label: "Reason" },
        header: "Reason",
        enableSorting: false,
        filterFn: facetFilterFn,
        cell: ({ row }) => (
          <div className="min-w-28">
            <StatusBadge tone="danger" dot={false}>
              {row.original.reason}
            </StatusBadge>
            {row.original.note ? <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{row.original.note}</p> : null}
          </div>
        ),
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        meta: { label: "Quantity wasted", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quantity wasted" align="right" />,
        cell: ({ row }) => <span className="tabular whitespace-nowrap">{qty(row.original.quantity, row.original.unit)}</span>,
      },
      moneyCol<WastedRow>("unitCost", "Cost per unit", (r) => r.unitCost, (r) => <Money value={r.unitCost} exact />),
      moneyCol<WastedRow>("value", "Value lost", (r) => r.value, (r) => <Money value={r.value} tone="negative" className="font-semibold" />, false),
      {
        id: "date",
        accessorKey: "date",
        meta: { label: "Date" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{day(row.original.date)}</span>,
      },
      {
        id: "from",
        accessorKey: "from",
        meta: { label: "Where" },
        header: "Where",
        enableSorting: false,
        filterFn: facetFilterFn,
        cell: ({ row }) => (
          <div className="min-w-32 text-sm">
            <p className="truncate">{row.original.where ?? (row.original.from === "project" ? "A project" : "Storage")}</p>
            <p className="text-xs text-muted-foreground">{row.original.from === "project" ? "In use on a project" : "From storage"}</p>
          </div>
        ),
      },
      {
        id: "responsible",
        accessorFn: (r) => `${r.department ?? ""} ${r.responsible ?? ""}`,
        meta: { label: "Department or person" },
        header: "Department or person",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{[row.original.department, row.original.responsible].filter(Boolean).join(" · ") || "Not recorded"}</span>
        ),
      },
    ],
    [],
  );
  const reasons = useMemo(() => [...new Set(rows.map((r) => r.reason))].map((r) => ({ value: r, label: r })), [rows]);
  return (
    <DataTable
      id="valuation-wasted"
      columns={columns}
      data={rows}
      pageSize={20}
      searchPlaceholder="Search item, person or department…"
      filters={[
        ...(reasons.length > 1 ? [{ key: "reason", title: "Reason", options: reasons }] : []),
        { key: "from", title: "Where", options: [{ value: "storage", label: "From storage" }, { value: "project", label: "In use on a project" }] },
      ]}
      getRowId={(r) => r.id}
      renderMobileRow={(r) => (
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/inventory/items/${r.itemId}`} className="min-w-0 flex-1 truncate font-medium">
              {r.name}
            </Link>
            <Money value={r.value} tone="negative" className="shrink-0 font-semibold" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {qty(r.quantity, r.unit)} · {r.reason} · {day(r.date)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {r.where ?? (r.from === "project" ? "On a project" : "Storage")}
            {r.department || r.responsible ? ` · ${[r.department, r.responsible].filter(Boolean).join(" · ")}` : ""}
          </p>
        </div>
      )}
      emptyState={
        <EmptyState
          compact
          icon={Trash2}
          title="No wastage recorded"
          description="Damaged, expired, lost or scrapped stock recorded on the Record wastage page shows here with its reason, value and who is answerable."
          action={
            <Link href="/inventory/wastage" className="text-sm font-medium text-brand-ink hover:underline">
              Record wastage
            </Link>
          }
        />
      }
    />
  );
}

/** Stock in storage, in use and wasted, one tab each. The open tab follows ?tab= so other pages can link to it. */
export function StockTables({
  storage,
  inUse,
  wasted,
}: {
  storage: StorageRow[];
  inUse: InUseRow[];
  wasted: WastedRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab") as StockTab | null;
  const tab: StockTab = requested && TABS.includes(requested) ? requested : "storage";
  const select = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "storage") next.delete("tab");
    else next.set("tab", value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={select} className="gap-4">
      <div className="max-w-full overflow-x-auto">
        <TabsList>
          <TabsTrigger value="storage">Stock in storage ({formatNumber(storage.length)})</TabsTrigger>
          <TabsTrigger value="in-use">Stock in use ({formatNumber(inUse.length)})</TabsTrigger>
          <TabsTrigger value="wasted">Wasted stock ({formatNumber(wasted.length)})</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="storage">
        <StorageTable rows={storage} />
      </TabsContent>
      <TabsContent value="in-use">
        <InUseTable rows={inUse} />
      </TabsContent>
      <TabsContent value="wasted">
        <WastedTable rows={wasted} />
      </TabsContent>
    </Tabs>
  );
}
