import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { requireUser } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { FixedAsset } from "@/server/models";
import type { SearchParams } from "@/lib/list-params";
import { AssetRegisterPage } from "@/features/finance/assets/fixed/components/asset-register-page";

export const metadata: Metadata = { title: "Fixed assets" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FixedAssetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  // The books link every asset here (?view=<id>); intangible ones open on their own page.
  const id = first(sp.view) ?? first(sp.edit);
  if (id && Types.ObjectId.isValid(id)) {
    await connectDB();
    const asset = await FixedAsset.findById(id, { kind: 1 }).lean();
    if (asset?.kind === "intangible") redirect(`/finance/assets/intangible?${sp.edit ? "edit" : "view"}=${id}`);
  }
  return <AssetRegisterPage kind="tangible" searchParams={sp} />;
}
