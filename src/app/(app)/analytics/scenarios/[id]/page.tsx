import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { formatDate, formatDateTime } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer } from "@/features/analytics/viewer";
import { getScenarioDetail } from "@/features/analytics/scenarios/queries";
import { ScenarioStatusBadge, ScenarioTypeBadge } from "@/features/analytics/scenarios/components/badges";
import { ScenarioActions } from "@/features/analytics/scenarios/components/scenario-actions";
import { ResultsSwitch } from "@/features/analytics/scenarios/components/results-switch";
import { HistoryTimeline } from "@/features/analytics/scenarios/components/history-timeline";
import { ApplyBudgetButton } from "@/features/analytics/scenarios/components/apply-budget-button";
import { scenarioBudgetTarget } from "@/features/analytics/scenarios/server/project-budget";

export const metadata: Metadata = { title: "Scenario" };

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.scenarios.view)) return <NoAccess eyebrow="Analytics & Planning" title="Scenario" />;
  const { id } = await params;
  // Worked out again from today's records on every visit; the saved figures stay as they were.
  const s = await getScenarioDetail(id, analyticsViewer(user));
  if (!s) notFound();
  // A whole-project budget scenario can become the project's budget (with the projects edit permission).
  const budgetTarget = s.type === "budget" && can(user, "finance.projects:edit") ? await scenarioBudgetTarget(s.id) : null;

  return (
    <Page>
      <PageHeader
        eyebrow={`Scenario ${s.code}`}
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <ScenarioTypeBadge type={s.type} />
            <ScenarioStatusBadge status={s.status} />
            <span>
              Created by {s.createdBy ?? "someone not recorded"} on {formatDate(s.createdAt)} · updated {formatDateTime(s.updatedAt)}
            </span>
          </span>
        }
        actions={
          <>
            {budgetTarget ? <ApplyBudgetButton target={budgetTarget} /> : null}
            <ScenarioActions id={s.id} code={s.code} status={s.status} hasSaved={Boolean(s.saved)} canExport={Boolean(s.live)} outdated={!s.saved || s.changedSinceSave.length > 0 || Boolean(s.savedNote)} canRecalculate={!s.savedHidden} />
          </>
        }
      />

      <Section title="Inputs and assumptions" description="What this scenario supposes. Nothing here is written to real records.">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-line">{s.description ?? "None given."}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Assumptions</p>
              <p className="mt-1 whitespace-pre-line">{s.assumptions ?? "None given."}</p>
            </div>
            {s.duplicatedFrom ? (
              <p className="text-xs text-muted-foreground">
                Copied from{" "}
                <Link href={`/analytics/scenarios/${s.duplicatedFrom.id}`} className="underline">
                  {s.duplicatedFrom.code} {s.duplicatedFrom.name}
                </Link>
              </p>
            ) : null}
          </div>
          <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            {s.inputSummary.map((l) => (
              <div key={l.label} className="contents">
                <dt className="text-muted-foreground">{l.label}</dt>
                <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">{l.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <ResultsSwitch live={s.live} saved={s.saved} savedAt={s.savedAt} savedHidden={s.savedHidden} savedNote={s.savedNote} liveError={s.liveError} changed={s.changedSinceSave} />

      <Section title="History" description="Who changed what and when, status moves and approvals.">
        <HistoryTimeline entries={s.history} />
      </Section>
    </Page>
  );
}
