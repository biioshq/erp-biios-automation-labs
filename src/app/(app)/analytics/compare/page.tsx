import type { Metadata } from "next";
import Link from "next/link";
import { Columns3, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer, userCanOpen } from "@/features/analytics/viewer";
import { getComparison, getScenarioChoices } from "@/features/analytics/scenarios/queries";
import { ComparePicker } from "@/features/analytics/scenarios/components/compare-picker";
import { CompareTable } from "@/features/analytics/scenarios/components/compare-table";

export const metadata: Metadata = { title: "Compare scenarios" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  // Comparing shows each scenario's results, so it also needs access to scenarios.
  if (!can(user, ANALYTICS.compare.view) || !can(user, ANALYTICS.scenarios.view)) return <NoAccess eyebrow="Analytics & Planning" title="Compare scenarios" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  const ids = first(sp.ids).split(",").map((s) => s.trim()).filter(Boolean);
  const basis = first(sp.basis) === "saved" ? "saved" : "today";
  const [choices, data] = await Promise.all([getScenarioChoices(), ids.length ? getComparison(ids, basis, analyticsViewer(user)) : Promise.resolve(null)]);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Compare scenarios"
        description="Put scenarios of any type side by side with the business as it stands today."
        actions={
          open("/analytics/compare/history") ? (
            <Button asChild variant="outline">
              <Link href="/analytics/compare/history">
                <History /> Scenario history
              </Link>
            </Button>
          ) : null
        }
      />
      {choices.length === 0 ? (
        <EmptyState
          icon={Columns3}
          title="No scenarios to compare yet"
          description="Create two or more scenarios, for example demand +10% and +20%, or a supply delay of 7 and 14 days, then compare them here."
          action={
            open("/analytics/scenarios/new") ? (
              <Button asChild>
                <Link href="/analytics/scenarios/new">
                  <Plus /> New scenario
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <ComparePicker choices={choices} selected={ids} basis={basis} />
          {data && data.columns.length ? (
            <>
              <Section
                title="Side by side"
                description={basis === "saved" ? "Each scenario as it was saved; a scenario without visible saved figures uses today's data." : "Every scenario worked out from today's records."}
                contentClassName="p-0 sm:p-0"
              >
                <CompareTable columns={data.columns} rows={data.rows} />
              </Section>
              <div className="grid gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-foreground">-</span> The measure does not apply to that type of scenario.
                </p>
                <p>Impact rows are the change from today, so the current position is zero there.</p>
                <p>Business position: open projects are those not completed or cancelled. Costs a scenario adds are counted once it plays out.</p>
                <p>{can(user, ANALYTICS.financialPosition) ? "Cash after the scenario takes off what it would buy and the extra manpower cost or, for a new project, its cash requirement." : "Cash figures are not shown for your role."}</p>
                {can(user, ANALYTICS.salaries) ? null : <p>Salary figures are not shown for your role.</p>}
              </div>
            </>
          ) : (
            <EmptyState
              compact
              icon={Columns3}
              title={ids.length ? "Those scenarios no longer exist" : "Pick scenarios to compare"}
              description="Pick two or more from the list above. Any types can be compared."
            />
          )}
        </>
      )}
    </Page>
  );
}
