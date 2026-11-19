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
    /** Weighted average cost per unit; assignments are costed at this price. */
    unitPrice: { type: Number, default: 0, min: 0 },
    lastPurchasePrice: { type: Number, min: 0 },
    vendor: { type: String, trim: true, maxlength: 200 },
    purchaseDate: { type: Date },
    description: { type: String, trim: true, maxlength: 2000 },
    location: { type: String, trim: true, maxlength: 120 },
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
