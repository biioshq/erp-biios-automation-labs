import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { INVENTORY_UNITS, valuesOf } from "@/lib/constants";

/**
 * A stock item. `available`, `allocated` and `quantity` (= available + allocated)
 * change only through the inventory ledger (src/server/services/inventory-ledger.ts),
 * which records a movement for every change.
 */
const inventoryItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 64 },
    category: { type: Schema.Types.ObjectId, ref: "InventoryCategory", index: true },
    unit: { type: String, enum: valuesOf(INVENTORY_UNITS), default: "pcs" },
    quantity: { type: Number, default: 0, min: 0 },
    available: { type: Number, default: 0, min: 0 },
    allocated: { type: Number, default: 0, min: 0 },
    /** Below or at this level the item is Low Stock. */
    minStock: { type: Number, default: 0, min: 0 },
    /**
     * Average cost per unit of the stock on hand, so stock value is available × unitPrice. Untracked
     * items (no `unexpensedQty`) are assigned at this price; tracked items cost each lot at its own
     * price (src/features/inventory/ledger/stock-cost.ts).
     */
    unitPrice: { type: Number, default: 0, min: 0 },
    lastPurchasePrice: { type: Number, min: 0 },
    /**
     * Units of `available` whose cost has not been expensed yet. Missing means all of `available`
     * (true for every item bought before purchases became expenses); the ledger writes it from the
     * first purchase on. Assigning these units creates a company expense, as before; assigning the
     * rest only moves their cost into the project. Always 0 to `available`. Changed only by the ledger.
     */
    unexpensedQty: { type: Number, min: 0 },
    /**
     * What the `unexpensedQty` units cost (rupees, to the paisa), pinned at the price they were on
     * the books at when tracking started. Assigning them expenses this, not the blended average.
     * Missing with `unexpensedQty` set means unexpensedQty × unitPrice. Changed only by the ledger.
     */
    unexpensedValue: { type: Number, min: 0 },
    /**
     * Not-yet-expensed units (and their cost) that stock adjustments removed. Found stock restores
     * these first, so a count correction (-3 then +3) never drops cost that was not booked yet.
     * Missing means none. Changed only by the ledger.
     */
    removedUnexpensedQty: { type: Number, min: 0 },
    removedUnexpensedValue: { type: Number, min: 0 },
    vendor: { type: String, trim: true, maxlength: 200 },
    purchaseDate: { type: Date },
    description: { type: String, trim: true, maxlength: 2000 },
    location: { type: String, trim: true, maxlength: 120 },
    /** Photo of the item (a stored file); optional. */
    photoFileId: { type: Schema.Types.ObjectId, ref: "File", default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
inventoryItemSchema.index({ name: "text", sku: "text", vendor: "text", description: "text" });
inventoryItemSchema.index({ vendor: 1 });
inventoryItemSchema.index({ available: 1, minStock: 1 });

export type InventoryItemDoc = InferSchemaType<typeof inventoryItemSchema> & { _id: Types.ObjectId };
export const InventoryItem: Model<InventoryItemDoc> =
  models.InventoryItem ?? model<InventoryItemDoc>("InventoryItem", inventoryItemSchema, "inventory");
