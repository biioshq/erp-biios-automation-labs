import type { Metadata } from "next";
import { NoAccess } from "@/components/shared/no-access";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { LiabilitySidePage } from "@/features/finance/liabilities/components/side-page";

export const metadata: Metadata = { title: "Non-current liabilities" };

export default async function NonCurrentLiabilitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!can(user, "finance.liabilities:view")) return <NoAccess title="Non-current liabilities" />;
  return <LiabilitySidePage side="non_current_liabilities" searchParams={await searchParams} />;
}
