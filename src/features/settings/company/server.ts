import "server-only";

import { connectDB } from "@/server/db";
import { CompanyProfile } from "@/server/models";
import { COMPANY } from "@/config/company";
import { COMPANY_FIELDS, EMPTY_COMPANY_DETAILS, type CompanyDetails } from "./schemas";

/**
 * The saved business details (every field a string, empty when not set), plus when they were last
 * saved. Nothing saved yet gives empty details; the documents then fall back to COMPANY.name.
 */
export async function getCompanyDetails(): Promise<{ details: CompanyDetails; saved: boolean; updatedAt: Date | null }> {
  await connectDB();
  const doc = await CompanyProfile.findOne({ key: "company" }).lean();
  if (!doc) return { details: { ...EMPTY_COMPANY_DETAILS }, saved: false, updatedAt: null };
  const details = { ...EMPTY_COMPANY_DETAILS };
  for (const field of COMPANY_FIELDS) details[field] = (doc[field] as string | undefined) ?? "";
  return { details, saved: true, updatedAt: (doc.updatedAt as Date | undefined) ?? null };
}

/** What a document prints for the company: the saved details with the legal name falling back to the configured name. */
export type CompanyIdentity = CompanyDetails & { displayName: string };

export async function getCompanyIdentity(): Promise<CompanyIdentity> {
  const { details } = await getCompanyDetails();
  return { ...details, displayName: details.legalName || details.tradeName || COMPANY.name };
}
