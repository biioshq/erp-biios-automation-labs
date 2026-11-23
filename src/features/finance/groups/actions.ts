"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { FinanceGroup, FixedAsset, Investment, Liability, CapitalEntry } from "@/server/models";
import { loadFinanceGroups, descendantsOf } from "@/server/finance-groups";
import { subgroupFormSchema, subgroupIdSchema } from "./schemas";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

/** Adds a subgroup under a built-in group or another subgroup. Anyone signed in can add one. */
export const createSubgroup = defineAction(
  subgroupFormSchema,
  async (input, user) => {
    const groups = await loadFinanceGroups();
    const parent = groups.find((g) => g.key === input.parent);
    if (!parent) throw new AppError("Pick where the subgroup goes.", "invalid", { parent: ["Pick where it goes"] });
    if (groups.some((g) => g.parent === input.parent && g.label.toLowerCase() === input.name.toLowerCase())) {
      throw new AppError(`${parent.label} already has a group named ${input.name}.`, "invalid", { name: ["That name is taken here"] });
    }
    const created = await FinanceGroup.create({
      kind: parent.kind,
      parent: input.parent,
      name: input.name,
      description: input.description,
      details: input.details,
      createdBy: new Types.ObjectId(user.id),
    });
    return { key: String(created._id), label: created.name };
  },
  { revalidate: REVALIDATE, message: "Subgroup added" },
);

/** Renames a subgroup or changes its description. Records keep pointing at it by id. */
export const updateSubgroup = defineAction(
  subgroupFormSchema.and(subgroupIdSchema),
  async (input) => {
    const existing = await FinanceGroup.findById(input.id).lean();
    if (!existing) throw notFound("The subgroup");
    await FinanceGroup.updateOne(
      { _id: existing._id },
      {
        $set: { name: input.name, ...(input.description ? { description: input.description } : {}), ...(input.details ? { details: input.details } : {}) },
        $unset: { ...(input.description ? {} : { description: 1 }), ...(input.details ? {} : { details: 1 }) },
      },
    );
    return { key: input.id };
  },
  { revalidate: REVALIDATE, message: "Subgroup updated" },
);

/**
 * Hides a subgroup from pickers. Only when nothing is filed under it or under a subgroup below it,
 * so no record loses its place on the balance sheet. Admins only.
 */
export const archiveSubgroup = defineAction(
  subgroupIdSchema,
  async ({ id }) => {
    const existing = await FinanceGroup.findById(id).lean();
    if (!existing) throw notFound("The subgroup");
    const keys = descendantsOf(await loadFinanceGroups(), id);
    const [assets, investments, liabilities, reserves] = await Promise.all([
      FixedAsset.countDocuments({ group: { $in: keys }, archivedAt: null }),
      Investment.countDocuments({ group: { $in: keys }, archivedAt: null }),
      Liability.countDocuments({ group: { $in: keys }, archivedAt: null }),
      CapitalEntry.countDocuments({ reserveGroup: { $in: keys } }),
    ]);
    const used = assets + investments + liabilities + reserves;
    if (used > 0) throw new AppError(`${used} ${used === 1 ? "record is" : "records are"} filed under this subgroup. Move them first.`, "conflict");
    await FinanceGroup.updateMany({ _id: { $in: keys.filter((k) => Types.ObjectId.isValid(k)).map((k) => new Types.ObjectId(k)) } }, { $set: { archivedAt: new Date() } });
    return { key: id };
  },
  { revalidate: REVALIDATE, message: "Subgroup removed", role: "admin" },
);
