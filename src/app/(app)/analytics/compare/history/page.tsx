import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { getHistoryUsers, listHistory } from "@/features/analytics/scenarios/queries";
import { HISTORY_FILTER_KEYS } from "@/features/analytics/scenarios/schemas";
import { HistoryView } from "@/features/analytics/scenarios/components/history-view";

export const metadata: Metadata = { title: "Scenario history" };

export default async function ScenarioHistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  // The history lists every scenario, so it also needs access to scenarios.
  if (!can(user, ANALYTICS.compare.view) || !can(user, ANALYTICS.scenarios.view)) return <NoAccess eyebrow="Analytics & Planning" title="Scenario history" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const params = parseListParams(await searchParams, { filterKeys: HISTORY_FILTER_KEYS, sortable: ["at"], defaultSort: { id: "at", desc: true } });
  const [data, users] = await Promise.all([listHistory(params), getHistoryUsers()]);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Scenario history"
        description="Every change to every scenario: who made it, when, status moves and approvals."
        actions={
          open("/analytics/scenarios") ? (
            <Button asChild variant="outline">
              <Link href="/analytics/scenarios">
                <FlaskConical /> All scenarios
              </Link>
            </Button>
          ) : null
        }
      />
      <HistoryView data={data} users={users} />
    </Page>
  );
}
