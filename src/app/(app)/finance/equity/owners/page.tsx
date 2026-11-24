import type { Metadata } from "next";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { HoldersPage } from "@/features/finance/equity/components/holders-page";

export const metadata: Metadata = { title: "Owners' capital" };

export default async function OwnersCapitalPage() {
  const user = await requireUser();
  if (!can(user, "finance.equity:view")) return <NoAccess title="Owners' capital" />;
  return <HoldersPage kind="owner" />;
}
