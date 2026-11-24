"use client";

import { useMemo, useOptimistic, useState, startTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ExternalLink, MoreHorizontal, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { useCan } from "@/components/current-user";
import { useIsMobile } from "@/hooks/use-mobile";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { deleteCategory } from "../actions";
import type { CategoryRow } from "../types";
import { CategoryDialog } from "./category-dialog";

/** Categories with usage figures. The dialog follows ?new=1 and ?edit=<id>. */
export function CategoriesView({ rows: initial, uncategorized }: { rows: CategoryRow[]; uncategorized: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, removeRow] = useOptimistic(initial, (state, id: string) => state.filter((r) => r.id !== id));
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const canEdit = useCan("inventory.categories:edit");
  const canDelete = useCan("inventory.categories:delete");
  const mobile = useIsMobile();

  const editId = searchParams.get("edit");
  const creating = searchParams.get("new") === "1";
  const editing = editId ? (rows.find((r) => r.id === editId) ?? null) : null;

  const closeDialog = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    params.delete("edit");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const open = (kind: "new" | "edit", id?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    params.delete("edit");
    if (kind === "new") params.set("new", "1");
    else if (id) params.set("edit", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  async function remove(category: CategoryRow) {
    startTransition(() => removeRow(category.id));
    const result = await deleteCategory({ id: category.id });
    if (!result.ok) {
      toast.error(result.error);
      router.refresh();
      return false;
    }
    toast.success(`${category.name} deleted`);
    emitDataChanged();
    return true;
  }

  const rowMenu = (c: CategoryRow) => {
    const inUse = c.itemCount > 0;
    return (
      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem asChild>
              <Link href={`/inventory/items?category=${c.id}`}>
                <ExternalLink /> View items
              </Link>
            </DropdownMenuItem>
            {canEdit ? (
              <DropdownMenuItem onSelect={() => open("edit", c.id)}>
                <Pencil /> Edit
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                {inUse ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <DropdownMenuItem variant="destructive" disabled>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left">{c.itemCount} items use this category</TooltipContent>
                  </Tooltip>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const columns = useMemo<ColumnDef<CategoryRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        cell: ({ row }) => (
          <div className="flex min-w-48 items-center gap-3">
            <span className="size-3 shrink-0 rounded-full" style={{ background: row.original.color }} />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              {row.original.description ? <p className="max-w-80 truncate text-xs text-muted-foreground">{row.original.description}</p> : null}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "itemCount",
        accessorKey: "itemCount",
        meta: { label: "Items", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Items" align="right" />,
        cell: ({ row }) => <span className="tabular font-medium">{formatNumber(row.original.itemCount)}</span>,
      },
      {
        id: "totalValue",
        accessorKey: "totalValue",
        meta: { label: "Total value", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Total value" align="right" />,
        cell: ({ row }) => <Money value={row.original.totalValue} className="font-semibold" />,
      },
      {
        id: "lowCount",
        accessorKey: "lowCount",
        meta: { label: "Low stock", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Low stock" align="right" />,
        cell: ({ row }) =>
          row.original.lowCount > 0 ? (
            <StatusBadge tone="warning">{row.original.lowCount}</StatusBadge>
          ) : (
            <span className="tabular text-muted-foreground/60">0</span>
          ),
      },
      {
        id: "outCount",
        accessorKey: "outCount",
        meta: { label: "Out of stock", align: "right" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Out of stock" align="right" />,
        cell: ({ row }) =>
          row.original.outCount > 0 ? (
            <StatusBadge tone="danger">{row.original.outCount}</StatusBadge>
          ) : (
            <span className="tabular text-muted-foreground/60">0</span>
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
    [searchParams, canEdit, canDelete],
  );

  return (
    <>
      {uncategorized > 0 ? (
        <p className="text-sm text-muted-foreground">
          <Link href="/inventory/items?category=none" className="font-medium text-foreground underline underline-offset-4">
            {formatNumber(uncategorized)} {uncategorized === 1 ? "item has" : "items have"} no category
          </Link>
          . Assign one from the item&apos;s edit form.
        </p>
      ) : null}
      <DataTable
        id="inventory-categories"
        columns={columns}
        data={rows}
        pageSize={20}
        searchPlaceholder="Search categories…"
        getRowId={(r) => r.id}
        onRowClick={mobile ? undefined : (r) => router.push(`/inventory/items?category=${r.id}`)}
        renderMobileRow={(c) => (
          <div className="flex items-start gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: c.color }} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Link href={`/inventory/items?category=${c.id}`} className="block truncate text-[15px] font-medium hover:underline">
                {c.name}
              </Link>
              {c.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p> : null}
              <p className="tabular flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {formatNumber(c.itemCount)} {c.itemCount === 1 ? "item" : "items"}
                </span>
                <Money value={c.totalValue} className="font-medium text-foreground" />
                {c.lowCount > 0 ? <StatusBadge tone="warning">{c.lowCount} low</StatusBadge> : null}
                {c.outCount > 0 ? <StatusBadge tone="danger">{c.outCount} out</StatusBadge> : null}
              </p>
            </div>
            <div className="-my-1 -mr-1.5 shrink-0">{rowMenu(c)}</div>
          </div>
        )}
        emptyState={
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Create categories such as Electronics, Raw materials or Tools, then file items under them."
            action={
              <Button onClick={() => open("new")}>
                <Plus /> New category
              </Button>
            }
          />
        }
      />

      {creating || editing ? (
        <CategoryDialog key={editing?.id ?? "new"} open category={editing} onOpenChange={(o) => !o && closeDialog()} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : "Delete category?"}
        description="No items use this category. It will be removed for good."
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
