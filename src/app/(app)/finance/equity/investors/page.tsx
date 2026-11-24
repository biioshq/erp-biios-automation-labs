import type { Metadata } from "next";
import { AdminOnly } from "@/components/shared/admin-only";
import { requireUser } from "@/server/auth/session";
import { HoldersPage } from "@/features/finance/equity/components/holders-page";

export const metadata: Metadata = { title: "Investors' capital" };

export default async function InvestorsCapitalPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Investors' capital" />;
  return <HoldersPage kind="investor" />;
}
