"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { CompanyProfile } from "@/server/models";
import { requireIndexes } from "@/server/new-indexes";
import { COMPANY_FIELDS, companyProfileSchema } from "./schemas";

/**
 * Saves the business details. Empty fields are removed from the document, so they are left off
 * the invoices and receipts. The single document is found by its unique key, so the key's index
 * must exist before the upsert (a second document would otherwise be possible).
 */
export const saveCompanyProfile = defineAction(
  companyProfileSchema,
  async (values, user) => {
    await requireIndexes(CompanyProfile);
    const set: Record<string, unknown> = { updatedBy: new Types.ObjectId(user.id) };
    const unset: Record<string, 1> = {};
    for (const field of COMPANY_FIELDS) {
      const value = values[field];
      if (value) set[field] = value;
      else unset[field] = 1;
    }
    await CompanyProfile.updateOne(
      { key: "company" },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { key: "company" } },
      { upsert: true },
    );
    return { saved: true };
  },
  { permission: "settings.company:edit", revalidate: [["/settings/company", "page"]], message: "Business details saved" },
);
