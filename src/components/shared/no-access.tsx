import { ShieldCheck } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * What a person sees on a page their role does not include. Pages return it after checking the
 * page's view permission on the server:
 *
 *   const user = await requireUser();
 *   if (!can(user, "finance.equity:view")) return <NoAccess title="Capital / Equity" />;
 */
export function NoAccess({
  title,
  eyebrow,
  description = "Your role does not include this page. Ask an admin if you need it.",
}: {
  title: string;
  eyebrow?: string;
  description?: string;
}) {
  return (
    <Page>
      <PageHeader eyebrow={eyebrow} title={title} />
      <EmptyState icon={ShieldCheck} title="No access" description={description} />
    </Page>
  );
}
