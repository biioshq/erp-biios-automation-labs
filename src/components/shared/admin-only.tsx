import { ShieldCheck } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * What a member sees on an admin-only page (capital, loans, cash balances, financial statements):
 * a plain note instead of the figures. Pages return it when `user.role !== "admin"`.
 */
export function AdminOnly({ title, eyebrow = "Finance" }: { title: string; eyebrow?: string }) {
  return (
    <Page>
      <PageHeader eyebrow={eyebrow} title={title} />
      <EmptyState icon={ShieldCheck} title="Only admins can see this page" description="It shows company money that only admins see, like capital, loans, bank balances and the financial statements. Ask an admin if you need a figure from it." />
    </Page>
  );
}
