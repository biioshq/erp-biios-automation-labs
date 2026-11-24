import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Columns3, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { getScenarioCreators, listScenarios } from "@/features/analytics/scenarios/queries";
import { SCENARIO_FILTER_KEYS, SCENARIO_SORT_KEYS } from "@/features/analytics/scenarios/schemas";
import { ScenariosView } from "@/features/analytics/scenarios/components/scenarios-view";

export const metadata: Metadata = { title: "What-if scenarios" };

export default async function ScenariosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.scenarios.view)) return <NoAccess eyebrow="Analytics & Planning" title="What-if scenarios" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  // The ERP's usual list links: ?new=1 opens the create form, ?view=<id> the record.
  if (sp.new === "1") redirect("/analytics/scenarios/new");
  if (typeof sp.view === "string" && /^[a-f\d]{24}$/i.test(sp.view)) redirect(`/analytics/scenarios/${sp.view}`);
  const params = parseListParams(sp, {
    filterKeys: SCENARIO_FILTER_KEYS,
    sortable: SCENARIO_SORT_KEYS,
    defaultSort: { id: "updatedAt", desc: true },
  });
  const [data, creators] = await Promise.all([listScenarios(params), getScenarioCreators()]);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="What-if scenarios"
        description={
          <>
            <span className="tabular">{formatNumber(data.total)}</span> {data.total === 1 ? "scenario" : "scenarios"}. Each one tries out a change against today&apos;s records and never changes stock, budgets, people or money.
          </>
        }
        actions={
          <>
            {open("/analytics/compare") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/compare">
                  <Columns3 /> Compare
                </Link>
              </Button>
            ) : null}
            {open("/analytics/compare/history") ? (
              <Button asChild variant="outline">
                <Link href="/analytics/compare/history">
                  <History /> History
                </Link>
              </Button>
            ) : null}
            {open("/analytics/scenarios/new") ? (
              <Button asChild>
                <Link href="/analytics/scenarios/new">
                  <Plus /> New scenario
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ScenariosView data={data} creators={creators} />
    </Page>
  );
}
