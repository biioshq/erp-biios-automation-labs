import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { PROJECT_STAGES, valuesOf } from "@/lib/constants";

/**
 * Stock a project holds from one assignment. Its generated expense always
 * equals `quantity × unitCost`; returns reduce `quantity` (latest assignment first).
 * Feeds the project's "Inventory Used" tab.
 */
const inventoryAllocationSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    item: { type: Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    /** Units still held (assigned − returned). */
    quantity: { type: Number, required: true, min: 0 },
    quantityAssigned: { type: Number, required: true, min: 0 },
    quantityReturned: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    stage: { type: String, enum: valuesOf(PROJECT_STAGES), required: true },
    assignedAt: { type: Date, required: true },
    expense: { type: Schema.Types.ObjectId, ref: "Expense" },
    movement: { type: Schema.Types.ObjectId, ref: "InventoryMovement" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
inventoryAllocationSchema.index({ project: 1, item: 1, assignedAt: -1 });
inventoryAllocationSchema.index({ item: 1 });

export type InventoryAllocationDoc = InferSchemaType<typeof inventoryAllocationSchema> & { _id: Types.ObjectId };
export const InventoryAllocation: Model<InventoryAllocationDoc> =
  models.InventoryAllocation ??
  model<InventoryAllocationDoc>("InventoryAllocation", inventoryAllocationSchema, "inventoryAllocations");
