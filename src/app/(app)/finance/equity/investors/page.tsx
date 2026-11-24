import type { Metadata } from "next";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { HoldersPage } from "@/features/finance/equity/components/holders-page";

export const metadata: Metadata = { title: "Investors' capital" };

export default async function InvestorsCapitalPage() {
  const user = await requireUser();
  if (!can(user, "finance.equity:view")) return <NoAccess title="Investors' capital" />;
  return <HoldersPage kind="investor" />;
}
