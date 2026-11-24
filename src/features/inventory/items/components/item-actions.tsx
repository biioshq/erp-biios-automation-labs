"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Copy, MapPin, MoreHorizontal, PackagePlus, Pencil, SlidersHorizontal, Trash, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useIsAdmin } from "@/components/current-user";
import { emitDataChanged } from "@/lib/events";
import { removeItem } from "../actions";
import type { ItemDetail } from "../types";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { ItemForm, type CategoryOption } from "./item-form";

/** Header actions for the item page: Buy more and the other stock links, adjust dialog, edit sheet, duplicate, archive. */
export function ItemActions({
  item,
  categories,
  vendors,
  subcategories = [],
}: {
  item: ItemDetail;
  categories: CategoryOption[];
  vendors: string[];
  subcategories?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [adjusting, setAdjusting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  // Archiving and deleting are admin-only (the action refuses members too).
  const isAdmin = useIsAdmin();

  const outOfStock = item.status === "out_of_stock";
  // Units wasted on a project stay in `allocated` but can no longer come back.
  const noAllocation = item.allocated - item.wastedInUse <= 1e-9;
  const editing = searchParams.get("edit") === item.id;
  const hasHistory = item.movementCount > 0;

  const setEditing = (open: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set("edit", item.id);
    else params.delete("edit");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  async function archive() {
    const result = await removeItem({ id: item.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(result.data.archived ? `${item.name} archived` : `${item.name} deleted`);
    emitDataChanged();
    router.push("/inventory/items");
    return true;
  }

  return (
    <>
      <Button asChild>
        <Link href={`/inventory/purchase?item=${item.id}`}>
          <PackagePlus /> Buy more
        </Link>
      </Button>

      {outOfStock ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button variant="outline" disabled>
                <ArrowUpFromLine /> Assign to project
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Out of stock. Purchase it before it can be assigned.</TooltipContent>
        </Tooltip>
      ) : (
        <Button variant="outline" asChild>
          <Link href={`/inventory/assign?item=${item.id}`}>
            <ArrowUpFromLine /> Assign to project
          </Link>
        </Button>
      )}

      {noAllocation ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button variant="outline" disabled>
                <ArrowDownToLine /> Return from project
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>No units are in use on projects.</TooltipContent>
        </Tooltip>
      ) : (
        <Button variant="outline" asChild>
          <Link href={`/inventory/return?item=${item.id}`}>
            <ArrowDownToLine /> Return from project
          </Link>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setAdjusting(true)}>
            <SlidersHorizontal /> Adjust stock
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/inventory/wastage?item=${item.id}`}>
              <Trash /> Record wastage
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/inventory/transfer?mode=location&item=${item.id}`}>
              <MapPin /> Move location
            </Link>
          </DropdownMenuItem>
          {noAllocation ? null : (
            <DropdownMenuItem asChild>
              <Link href={`/inventory/transfer?item=${item.id}`}>
                <ArrowLeftRight /> Move between projects
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Edit item
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            {/* A new item with these details: name, stock and history start fresh. */}
            <Link href={`/inventory/items?new=1&copy=${item.id}`}>
              <Copy /> Duplicate
            </Link>
          </DropdownMenuItem>
          {isAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(true)}>
                {hasHistory ? <Archive /> : <Trash2 />} {hasHistory ? "Archive" : "Delete"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AdjustStockDialog item={item} open={adjusting} onOpenChange={setAdjusting} />

      <FormSheet open={editing} onOpenChange={setEditing} title="Edit item" description={item.sku}>
        {editing ? (
          // Keyed by id only: someone else's stock movement bumps updatedAt, and the live refresh
          // that follows must not remount an open form and drop what is being typed. The open form
          // keeps the values it was filled with; updateItem leaves a vendor or purchase date that a
          // purchase changed meanwhile alone unless the user edited that field.
          <ItemForm
            key={item.id}
            item={item}
            categories={categories}
            vendors={vendors}
            subcategories={subcategories}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={isAdmin && archiving}
        onOpenChange={setArchiving}
        title={hasHistory ? `Archive ${item.name}?` : `Delete ${item.name}?`}
        description={
          hasHistory
            ? "The item is hidden from inventory lists. Its movements and the project costs it created stay in the records. Items still in stock or assigned to projects cannot be archived."
            : "This item has no stock history, so it will be deleted for good."
        }
        confirmLabel={hasHistory ? "Archive" : "Delete"}
        onConfirm={archive}
      />
    </>
  );
}
