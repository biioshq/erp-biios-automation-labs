import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/shared/page";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { AUDIT_FILTER_KEYS } from "@/lib/audit";
import { auditActors, listAuditLogs } from "@/features/finance/audit/queries";
import { AuditView } from "@/features/finance/audit/components/audit-view";

export const metadata: Metadata = { title: "Audit trail" };

export default async function AuditTrailPage({ searchParams }: PageProps<"/finance/audit">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.audit:view")) return <NoAccess title="Audit trail" />;
  const params = parseListParams(await searchParams, {
    filterKeys: AUDIT_FILTER_KEYS,
    sortable: ["at"],
    defaultSort: { id: "at", desc: true },
    defaultPageSize: 50,
  });
  const [data, actors] = await Promise.all([listAuditLogs(params, user), auditActors(user)]);
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Audit trail"
        description={
          <>
            Who added, imported, edited, reclassified, paid or deleted a record, and when. <span className="tabular">{formatNumber(data.total)}</span>{" "}
            {data.total === 1 ? "entry" : "entries"}
            {filtered ? " (filtered)" : ""}.{can(user, "data.salaries") ? "" : " Salary entries are not shown to your role."}
          </>
        }
      />
      <AuditView data={data} actors={actors} />
    </Page>
  );
}
