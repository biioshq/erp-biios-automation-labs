import type { Metadata } from "next";
import { AdminOnly } from "@/components/shared/admin-only";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { LiabilitySidePage } from "@/features/finance/liabilities/components/side-page";

export const metadata: Metadata = { title: "Non-current liabilities" };

export default async function NonCurrentLiabilitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Non-current liabilities" />;
  return <LiabilitySidePage side="non_current_liabilities" searchParams={await searchParams} />;
}
