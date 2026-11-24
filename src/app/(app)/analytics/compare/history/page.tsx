import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { getHistoryUsers, listHistory } from "@/features/analytics/scenarios/queries";
import { HISTORY_FILTER_KEYS } from "@/features/analytics/scenarios/schemas";
import { HistoryView } from "@/features/analytics/scenarios/components/history-view";

export const metadata: Metadata = { title: "Scenario history" };

export default async function ScenarioHistoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const params = parseListParams(await searchParams, { filterKeys: HISTORY_FILTER_KEYS, sortable: ["at"], defaultSort: { id: "at", desc: true } });
  const [data, users] = await Promise.all([listHistory(params), getHistoryUsers()]);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Scenario history"
        description="Every change to every scenario: who made it, when, status moves and approvals."
        actions={
          <Button asChild variant="outline">
            <Link href="/analytics/scenarios">
              <FlaskConical /> All scenarios
            </Link>
          </Button>
        }
      />
      <HistoryView data={data} users={users} />
    </Page>
  );
}
