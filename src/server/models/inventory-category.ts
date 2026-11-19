import { Schema, model, models, type InferSchemaType, type Model, type Types } from "mongoose";

const inventoryCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500 },
    color: { type: String, default: "#4a82cc" },
  },
  { timestamps: true },
);

export type InventoryCategoryDoc = InferSchemaType<typeof inventoryCategorySchema> & { _id: Types.ObjectId };
export const InventoryCategory: Model<InventoryCategoryDoc> =
  models.InventoryCategory ?? model<InventoryCategoryDoc>("InventoryCategory", inventoryCategorySchema, "inventoryCategories");
