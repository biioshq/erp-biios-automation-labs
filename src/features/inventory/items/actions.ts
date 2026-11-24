"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { InventoryAllocation, InventoryCategory, InventoryItem, InventoryMovement } from "@/server/models";
import { adjustStock, recordOpeningStock, roundQty } from "@/server/services/inventory-ledger";
import { notifyStockLevel } from "@/server/services/notifications";
import { getCurrentUser } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { fromDateInput } from "@/lib/dates";
import { formatNumber } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import {
  adjustStockSchema,
  copyNameSchema,
  itemFormSchema,
  itemIdSchema,
  itemLoadedSchema,
  similarItemsSchema,
  suggestSkuSchema,
  type ItemFormValues,
} from "./schemas";
import { getItemForm } from "./queries";
import { copyBaseName, copyName, exactNamePattern, matchItemName, namePrefixPattern, normalizeItemName, normalizeSku } from "./matching";
import type { ItemFormRecord, SimilarItem } from "./types";
import { cleanAttributes, partDifference, type ItemAttribute, type PartTraits } from "./attributes";

const sameDetails = (a: ItemAttribute[], b: ItemAttribute[]) =>
  a.length === b.length && a.every((x, i) => x.label === b[i]!.label && x.value === b[i]!.value);
import { removeFile } from "@/features/files/server";

/** Anything that touches stock also moves Finance numbers (purchase expenses, inventory value, GST input credit). */
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

/**
 * One active item per part: adding the same item again would split its stock and history in two,
 * so the form points to Buy more instead. Items may share a name only when a detail tells them
 * apart (a 110 ohm and a 180K ohm "Metal film resistor": attributes.ts). Archived items do not
 * count. Checked in code because existing data may already hold duplicates, so there is no
 * unique index on the name.
 */
async function assertNameFree(name: string, traits: PartTraits, exceptId?: string) {
  const sameName = await InventoryItem.find(
    { name: exactNamePattern(name), archivedAt: null, ...(exceptId ? { _id: { $ne: exceptId } } : {}) },
    { name: 1, sku: 1, subcategory: 1, attributes: 1 },
  ).lean();
  const clash = sameName.find((i) => !partDifference(traits, i));
  if (clash) {
    throw new AppError(
      sameName.length > 1 || (traits.attributes ?? []).length || traits.subcategory
        ? `${clash.name} (${clash.sku}) is already in inventory with the same details. Use Buy more on that item, or set the detail that tells this part apart (such as its value or size).`
        : `${clash.name} (${clash.sku}) is already in inventory. Use Buy more on that item to add stock instead of adding it again.`,
      "conflict",
      { name: ["Already in inventory"] },
    );
  }
}

function descriptiveFields(v: ItemFormValues) {
  return {
    name: v.name,
    sku: v.sku,
    category: v.categoryId ? new Types.ObjectId(v.categoryId) : undefined,
    subcategory: v.subcategory,
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
    await assertNameFree(input.name, input);
    await assertSkuFree(input.sku);
    const created = await InventoryItem.create({
      ...descriptiveFields(input),
      ...(input.attributes?.length ? { attributes: input.attributes } : {}),
      ...(typeof input.leadTimeDays === "number" ? { leadTimeDays: input.leadTimeDays } : {}),
      quantity: 0,
      available: 0,
      allocated: 0,
      unitPrice: 0,
    });
    const openingQuantity = input.openingQuantity ?? 0;
    if (openingQuantity > 0) {
      try {
        const date = input.purchaseDate ? fromDateInput(input.purchaseDate) : new Date();
        // Booked as a purchase (with its expense) unless the stock was already on hand.
        await recordOpeningStock(String(created._id), openingQuantity, input.openingUnitPrice ?? 0, input.vendor, date, user.id, {
          asPurchase: input.openingAsPurchase ?? true,
          paymentMethod: input.openingPaymentMethod,
        });
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
  itemFormSchema.and(itemIdSchema).and(itemLoadedSchema),
  async (input) => {
    const existing = await InventoryItem.findOne({ _id: input.id, archivedAt: null }).lean();
    if (!existing) throw notFound("The inventory item");
    await assertCategory(input.categoryId);
    // Quantities are deliberately absent: they change only through the ledger.
    const { vendor, purchaseDate, subcategory, ...fields } = descriptiveFields(input);
    // A purchase recorded while the form was open sets the item's vendor and purchase date, and an
    // import can fill its details. A field the user left at its loaded value keeps what is stored now
    // rather than the older copy; a form that did not load the details leaves them alone.
    const loaded = input.loaded;
    const keepVendor = loaded !== undefined && (vendor ?? null) === (loaded.vendor?.trim() || null);
    const keepPurchaseDate = loaded !== undefined && (input.purchaseDate ?? null) === (loaded.purchaseDate || null);
    const keepSubcategory = loaded?.subcategory === undefined || (subcategory ?? null) === (loaded.subcategory?.trim() || null);
    const keepAttributes =
      input.attributes === undefined || loaded?.attributes === undefined || sameDetails(input.attributes, cleanAttributes(loaded.attributes));

    // Only a rename is checked, so items that already share a name keep saving as they are.
    if (normalizeItemName(input.name) !== normalizeItemName(existing.name)) {
      await assertNameFree(
        input.name,
        {
          subcategory: keepSubcategory ? (existing.subcategory ?? null) : (subcategory ?? null),
          attributes: keepAttributes ? existing.attributes : input.attributes,
        },
        input.id,
      );
    }
    if (input.sku !== existing.sku) await assertSkuFree(input.sku, input.id);
    await InventoryItem.updateOne(
      { _id: existing._id },
      {
        $set: {
          ...fields,
          // Details are replaced only when the form changed them (an empty list clears them).
          ...(!keepAttributes && input.attributes?.length ? { attributes: input.attributes } : {}),
          ...(keepSubcategory || !subcategory ? {} : { subcategory }),
          ...(keepVendor ? {} : { vendor }),
          ...(keepPurchaseDate ? {} : { purchaseDate }),
          // Missing from the input (an older form) leaves the lead time as stored; null clears it.
          ...(typeof input.leadTimeDays === "number" ? { leadTimeDays: input.leadTimeDays } : {}),
        },
        $unset: {
          ...(fields.category ? {} : { category: 1 }),
          ...(vendor || keepVendor ? {} : { vendor: 1 }),
          ...(fields.description ? {} : { description: 1 }),
          ...(keepSubcategory || subcategory ? {} : { subcategory: 1 }),
          ...(!keepAttributes && input.attributes && !input.attributes.length ? { attributes: 1 } : {}),
          ...(fields.location ? {} : { location: 1 }),
          ...(purchaseDate || keepPurchaseDate ? {} : { purchaseDate: 1 }),
          ...(input.leadTimeDays === null ? { leadTimeDays: 1 } : {}),
        },
      },
    );
    // A new minimum can move the item between In Stock, Low Stock and Out of Stock right away.
    if (fields.minStock !== existing.minStock) {
      await notifyStockLevel(existing, { ...existing, minStock: fields.minStock });
    }
    return { id: input.id, status: getStockStatus(roundQty(existing.available), fields.minStock) };
  },
  { revalidate: REVALIDATE, message: "Item updated" },
);

/** Stock below this is float drift from older writes, not real units. */
const EMPTY = 1e-9;

/** Units of an item projects hold and could still return (held less wasted). */
async function stockInUse(itemId: Types.ObjectId) {
  const [row] = await InventoryAllocation.aggregate<{ n: number }>([
    { $match: { item: itemId, quantity: { $gt: 0 } } },
    { $group: { _id: null, n: { $sum: { $subtract: ["$quantity", { $ifNull: ["$quantityWasted", 0] }] } } } },
  ]);
  return roundQty(Math.max(0, row?.n ?? 0));
}

/**
 * Items with history are archived so their movements and project costs stay
 * traceable. Items that were never used are deleted. Admin-only, like every delete.
 *
 * Only an empty item can go: stock still on hand would drop out of the
 * inventory value with no record, so it has to be written off with an
 * adjustment first (which records the movement and its value).
 */
export const removeItem = defineAction(
  itemIdSchema,
  async ({ id }) => {
    const item = await InventoryItem.findOne({ _id: id, archivedAt: null }).lean();
    if (!item) throw notFound("The inventory item");
    // Units wasted on a project stay in `allocated` for good (the project bore their cost), so only
    // units still in use there block archiving.
    const inUse = item.allocated > EMPTY ? await stockInUse(item._id) : 0;
    if (inUse > EMPTY) {
      throw new AppError(
        `${formatNumber(inUse)} ${item.unit} of ${item.name} are still in use on projects. Return them before archiving.`,
        "conflict",
      );
    }
    if (item.available > EMPTY) {
      throw new AppError(
        `${formatNumber(item.available)} ${item.unit} of ${item.name} are still in stock. Use Adjust stock to remove them first, so the write-off is recorded.`,
        "conflict",
      );
    }
    // The writes repeat the checks, so a purchase or assignment that lands in between
    // makes this fail instead of leaving stock on an archived or deleted item.
    const empty = { _id: item._id, archivedAt: null, available: { $lte: EMPTY }, allocated: { $lte: item.allocated + EMPTY } };
    const changed = () => new AppError(`${item.name} changed while removing it. Reload and try again.`, "conflict");
    const movements = await InventoryMovement.countDocuments({ item: item._id });
    if (movements > 0) {
      const archived = await InventoryItem.updateOne(empty, { $set: { archivedAt: new Date() } });
      if (archived.matchedCount === 0) throw changed();
      return { id, archived: true };
    }
    const deleted = await InventoryItem.deleteOne(empty);
    if (deleted.deletedCount === 0) throw changed();
    // Archived items keep their photo; a deleted one leaves nothing behind.
    if (item.photoFileId) await removeFile(String(item.photoFileId)).catch(() => undefined);
    return { id, archived: false };
  },
  { role: "admin", revalidate: REVALIDATE },
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
}, { readOnly: true });

/**
 * Duplicate: a name for the new item that no active item has yet, "<name> (copy)" or the first free
 * "<name> (copy N)", so a second copy of the same item is not refused as a duplicate. Read-only.
 */
export const suggestCopyName = defineAction(copyNameSchema, async ({ name }) => {
  const base = copyBaseName(name);
  const rows = await InventoryItem.find({ name: namePrefixPattern(base), archivedAt: null }, { name: 1 }).lean();
  const taken = new Set(rows.map((r) => normalizeItemName(r.name ?? "")));
  for (let n = 1; n < 1000; n++) {
    const candidate = copyName(base, n);
    if (!taken.has(normalizeItemName(candidate))) return { name: candidate };
  }
  return { name: copyName(base, 1) };
}, { readOnly: true });

const MATCH_ORDER: Record<SimilarItem["match"], number> = { exact: 0, sku: 1, similar: 2 };

/**
 * Add item: active items with the same or a very similar name, or the same SKU, so the form can
 * offer Buy more instead of a second copy. Read-only.
 */
export const findSimilarItems = defineAction(
  similarItemsSchema,
  async ({ name, sku }): Promise<SimilarItem[]> => {
    const typedSku = sku ? normalizeSku(sku) : "";
    if (normalizeItemName(name).length < 2 && !typedSku) return [];
    const items = await InventoryItem.find({ archivedAt: null }, { name: 1, sku: 1, unit: 1, available: 1 }).lean();
    const found: SimilarItem[] = [];
    for (const i of items) {
      const byName = matchItemName(name, i.name);
      const match = byName === "exact" ? "exact" : typedSku && i.sku === typedSku ? "sku" : byName;
      if (!match) continue;
      found.push({ id: String(i._id), name: i.name, sku: i.sku, unit: i.unit ?? "pcs", available: roundQty(i.available ?? 0), match });
    }
    return found.sort((a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match] || a.name.localeCompare(b.name)).slice(0, 3);
  },
  { readOnly: true },
);

/** Loads one item for the edit form. */
export async function fetchItem(id: string): Promise<ItemFormRecord | null> {
  if (!(await getCurrentUser())) return null;
  await connectDB();
  return getItemForm(id);
}
