import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";
import { MOVEMENT_TYPES, PROJECT_STAGES, valuesOf } from "@/lib/constants";

/** Purchase invoice details, so stock purchases count toward GST input credit. */
const purchaseInvoiceSchema = new Schema(
  {
    number: { type: String, trim: true },
    date: { type: Date },
    gstin: { type: String, uppercase: true, trim: true },
    taxableAmount: { type: Number, min: 0, default: 0 },
    cgst: { type: Number, min: 0, default: 0 },
    sgst: { type: Number, min: 0, default: 0 },
    igst: { type: Number, min: 0, default: 0 },
    cess: { type: Number, min: 0, default: 0 },
    hsnSac: { type: String, trim: true },
    total: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

/** Append-only stock history. One document per change. */
const inventoryMovementSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    type: { type: String, enum: valuesOf(MOVEMENT_TYPES), required: true, index: true },
    /** Units moved, always positive. */
    quantity: { type: Number, required: true, min: 0 },
    /** Signed change to `available` (purchase +, assign −, return +, adjustment ±). */
    availableDelta: { type: Number, required: true },
    /** Signed change to `allocated` (assign +, return −). */
    allocatedDelta: { type: Number, default: 0 },
    project: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    stage: { type: String, enum: valuesOf(PROJECT_STAGES) },
    unitCost: { type: Number, min: 0, default: 0 },
    totalCost: { type: Number, min: 0, default: 0 },
    vendor: { type: String, trim: true },
    invoice: { type: purchaseInvoiceSchema, default: undefined },
    receipt: { type: Schema.Types.ObjectId, ref: "File" },
    /** Purchase: the expense it booked. Assign: the assignment's expense (the company one when there are two). */
    expense: { type: Schema.Types.ObjectId, ref: "Expense" },
    /** Signed change to the item's not-yet-expensed stock (InventoryItem.unexpensedQty); missing when none. */
    unexpensedDelta: { type: Number },
    allocation: { type: Schema.Types.ObjectId, ref: "InventoryAllocation" },
    /** Item levels right after this movement. */
    balance: {
      available: { type: Number, required: true },
      allocated: { type: Number, required: true },
      quantity: { type: Number, required: true },
    },
    note: { type: String, trim: true, maxlength: 1000 },
    date: { type: Date, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
inventoryMovementSchema.index({ item: 1, date: -1, _id: -1 });

export type InventoryMovementDoc = InferSchemaType<typeof inventoryMovementSchema> & { _id: Types.ObjectId };
export const InventoryMovement: Model<InventoryMovementDoc> =
  models.InventoryMovement ?? model<InventoryMovementDoc>("InventoryMovement", inventoryMovementSchema, "inventoryMovements");
