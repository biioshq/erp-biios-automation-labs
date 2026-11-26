import type { Metadata } from "next";
import { Info } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { NoAccess } from "@/components/shared/no-access";
import { COMPANY } from "@/config/company";
import { formatDateTime } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { getCompanyDetails } from "@/features/settings/company/server";
import { CompanyForm } from "@/features/settings/company/components/company-form";

export const metadata: Metadata = { title: "Business details" };

export default async function CompanyPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "settings.company:view")) return <NoAccess eyebrow="Settings" title="Business details" />;
  const canEdit = can(user, "settings.company:edit");
  const { details, saved, updatedAt } = await getCompanyDetails();

  return (
    <Page>
      <PageHeader
        eyebrow="Settings"
        title="Business details"
        description={
          canEdit
            ? "The details printed on invoices, receipts and statements. A field left empty is left off."
            : "The details printed on invoices, receipts and statements. Your role can read these but not change them."
        }
      />
      {!saved ? (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-info/25 bg-info/5 px-3.5 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p className="min-w-0 text-pretty">
            <span className="font-medium">Nothing saved yet.</span>{" "}
            <span className="text-muted-foreground">Documents print only the name &quot;{COMPANY.name}&quot; and the logo until the details are saved.</span>
          </p>
        </div>
      ) : updatedAt ? (
        <p className="-mt-2 text-xs text-muted-foreground">Last saved {formatDateTime(updatedAt)}</p>
      ) : null}
      <div className="max-w-3xl">
        <CompanyForm details={details} canEdit={canEdit} configuredStateCode={COMPANY.stateCode} />
      </div>
    </Page>
  );
}
