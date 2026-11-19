"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { InventoryCategory, InventoryItem, InventoryMovement } from "@/server/models";
import { adjustStock, recordOpeningStock } from "@/server/services/inventory-ledger";
import { notifyStockLevel } from "@/server/services/notifications";
import { getCurrentUser } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { fromDateInput } from "@/lib/dates";
import { getStockStatus } from "@/lib/stock-status";
import { adjustStockSchema, itemFormSchema, itemIdSchema, suggestSkuSchema, type ItemFormValues } from "./schemas";
import { getItemForm } from "./queries";
import type { ItemFormRecord } from "./types";

/** Anything that touches stock also moves Finance numbers (inventory value, GST input credit). */
const REVALIDATE: [string, "layout"][] = [
  ["/inventory", "layout"],
  ["/finance", "layout"],
];

async function assertCategory(categoryId: string | undefined) {
  if (!categoryId) return;
  if (!(await InventoryCategory.exists({ _id: categoryId }))) {
    throw new AppError("That category no longer exists.", "not_found", { categoryId: ["Pick another category"] });
  }
}

async function assertSkuFree(sku: string, exceptId?: string) {
  const clash = await InventoryItem.findOne({ sku, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { archivedAt: 1 }).lean();
  if (clash) {
    throw new AppError(
      clash.archivedAt ? `SKU ${sku} belongs to an archived item.` : `SKU ${sku} is already used by another item.`,
      "conflict",
      { sku: ["Already in use"] },
    );
  }
}

function descriptiveFields(v: ItemFormValues) {
  return {
    name: v.name,
    sku: v.sku,
    category: v.categoryId ? new Types.ObjectId(v.categoryId) : undefined,
    unit: v.unit,
    minStock: v.minStock ?? 0,
    vendor: v.vendor,
    description: v.description,
    location: v.location,
    purchaseDate: v.purchaseDate ? fromDateInput(v.purchaseDate) : undefined,
  };
}

export const createItem = defineAction(
  itemFormSchema,
  async (input, user) => {
    await assertCategory(input.categoryId);
    await assertSkuFree(input.sku);
    const created = await InventoryItem.create({ ...descriptiveFields(input), quantity: 0, available: 0, allocated: 0, unitPrice: 0 });
    const openingQuantity = input.openingQuantity ?? 0;
    if (openingQuantity > 0) {
      try {
        const date = input.purchaseDate ? fromDateInput(input.purchaseDate) : new Date();
        await recordOpeningStock(String(created._id), openingQuantity, input.openingUnitPrice ?? 0, input.vendor, date, user.id);
      } catch (error) {
        // An item without its opening stock would be misleading: undo the create.
        await InventoryItem.deleteOne({ _id: created._id });
        throw error;
      }
    }
    return { id: String(created._id) };
  },
  { revalidate: REVALIDATE, message: "Item added" },
);

export const updateItem = defineAction(
  itemFormSchema.and(itemIdSchema),
  async (input) => {
    const existing = await InventoryItem.findOne({ _id: input.id, archivedAt: null }).lean();
    if (!existing) throw notFound("The inventory item");
    await assertCategory(input.categoryId);
    if (input.sku !== existing.sku) await assertSkuFree(input.sku, input.id);

    // Quantities are deliberately absent: they change only through the ledger.
    const fields = descriptiveFields(input);
    await InventoryItem.updateOne(
      { _id: existing._id },
      {
        $set: fields,
        $unset: {
          ...(fields.category ? {} : { category: 1 }),
          ...(fields.vendor ? {} : { vendor: 1 }),
          ...(fields.description ? {} : { description: 1 }),
          ...(fields.location ? {} : { location: 1 }),
          ...(fields.purchaseDate ? {} : { purchaseDate: 1 }),
        },
      },
    );
    // A new minimum can move the item between In Stock, Low Stock and Out of Stock right away.
    if (fields.minStock !== existing.minStock) {
      await notifyStockLevel(existing, { ...existing, minStock: fields.minStock });
    }
    return { id: input.id, status: getStockStatus(existing.available, fields.minStock) };
  },
  { revalidate: REVALIDATE, message: "Item updated" },
);

/**
 * Items with history are archived so their movements and project costs stay
 * traceable. Items that were never used are deleted.
 */
export const removeItem = defineAction(
  itemIdSchema,
  async ({ id }) => {
    const item = await InventoryItem.findOne({ _id: id, archivedAt: null }).lean();
    if (!item) throw notFound("The inventory item");
    if (item.allocated > 0) {
      throw new AppError(
        `${item.allocated} ${item.unit} of ${item.name} are still assigned to projects. Return them before archiving.`,
        "conflict",
      );
    }
    const movements = await InventoryMovement.countDocuments({ item: item._id });
    if (movements > 0) {
      await InventoryItem.updateOne({ _id: item._id }, { $set: { archivedAt: new Date() } });
      return { id, archived: true };
    }
    await InventoryItem.deleteOne({ _id: item._id });
    return { id, archived: false };
  },
  { revalidate: REVALIDATE },
);

export const adjustItemStock = defineAction(
  adjustStockSchema,
  async (input, user) => {
    const { item } = await adjustStock({ itemId: input.id, delta: input.delta, reason: input.reason, date: new Date() }, user.id);
    return { id: input.id, available: item.available, status: getStockStatus(item.available, item.minStock) };
  },
  { revalidate: REVALIDATE, message: "Stock adjusted" },
);

/** A SKU proposal from the item name and category, made unique against existing SKUs. */
export const suggestSku = defineAction(suggestSkuSchema, async ({ name, categoryId }) => {
  const letters = (text: string, n: number) => text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n);
  const category = categoryId ? await InventoryCategory.findById(categoryId, { name: 1 }).lean() : null;
  const words = name.split(/\s+/).filter(Boolean);
  const namePart = words.length > 1 ? words.slice(0, 3).map((w) => letters(w, 3)).join("-") : letters(name, 6);
  const base = [category ? letters(category.name, 3) : "", namePart].filter(Boolean).join("-") || "ITEM";
  for (let n = 1; n < 1000; n++) {
    const candidate = `${base}-${String(n).padStart(3, "0")}`;
    if (!(await InventoryItem.exists({ sku: candidate }))) return { sku: candidate };
  }
  return { sku: base };
});

/** Loads one item for the edit form. */
export async function fetchItem(id: string): Promise<ItemFormRecord | null> {
  if (!(await getCurrentUser())) return null;
  await connectDB();
  return getItemForm(id);
}
