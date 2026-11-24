import type { Metadata } from "next";
import { AdminOnly } from "@/components/shared/admin-only";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { LiabilitySidePage } from "@/features/finance/liabilities/components/side-page";

export const metadata: Metadata = { title: "Current liabilities" };

export default async function CurrentLiabilitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Current liabilities" />;
  return <LiabilitySidePage side="current_liabilities" searchParams={await searchParams} />;
}
