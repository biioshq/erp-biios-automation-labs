"use server";

import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { InventoryCategory, InventoryItem } from "@/server/models";
import { categoryFormSchema, categoryIdSchema } from "./schemas";

const REVALIDATE: [string, "layout"][] = [["/inventory", "layout"]];

async function assertNameFree(name: string, exceptId?: string) {
  const clash = await InventoryCategory.findOne({ name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
    .collation({ locale: "en", strength: 2 })
    .lean();
  if (clash) throw new AppError(`A category named ${clash.name} already exists.`, "conflict", { name: ["Already in use"] });
}

export const createCategory = defineAction(
  categoryFormSchema,
  async (input) => {
    await assertNameFree(input.name);
    const created = await InventoryCategory.create(input);
    return { id: String(created._id) };
  },
  { permission: "inventory.categories:create", revalidate: REVALIDATE, message: "Category added" },
);

export const updateCategory = defineAction(
  categoryFormSchema.and(categoryIdSchema),
  async ({ id, ...input }) => {
    const existing = await InventoryCategory.findById(id).lean();
    if (!existing) throw notFound("The category");
    await assertNameFree(input.name, id);
    await InventoryCategory.updateOne(
      { _id: id },
      { $set: { name: input.name, color: input.color, ...(input.description ? { description: input.description } : {}) }, ...(input.description ? {} : { $unset: { description: 1 } }) },
    );
    return { id };
  },
  { permission: "inventory.categories:edit", revalidate: REVALIDATE, message: "Category updated" },
);

/** Deleted only when no active item uses it. Archived items lose the reference. */
export const deleteCategory = defineAction(
  categoryIdSchema,
  async ({ id }) => {
    const existing = await InventoryCategory.findById(id).lean();
    if (!existing) throw notFound("The category");
    const inUse = await InventoryItem.countDocuments({ category: existing._id, archivedAt: null });
    if (inUse > 0) {
      throw new AppError(
        `${existing.name} is used by ${inUse} ${inUse === 1 ? "item" : "items"}. Move them to another category first.`,
        "conflict",
      );
    }
    await InventoryItem.updateMany({ category: existing._id }, { $unset: { category: 1 } });
    await InventoryCategory.deleteOne({ _id: existing._id });
    return { id };
  },
  { permission: "inventory.categories:delete", revalidate: REVALIDATE, message: "Category deleted" },
);
