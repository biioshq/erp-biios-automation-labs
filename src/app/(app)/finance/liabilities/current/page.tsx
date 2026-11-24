import type { Metadata } from "next";
import { NoAccess } from "@/components/shared/no-access";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { LiabilitySidePage } from "@/features/finance/liabilities/components/side-page";

export const metadata: Metadata = { title: "Current liabilities" };

export default async function CurrentLiabilitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!can(user, "finance.liabilities:view")) return <NoAccess title="Current liabilities" />;
  return <LiabilitySidePage side="current_liabilities" searchParams={await searchParams} />;
}
