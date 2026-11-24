import type { Metadata } from "next";
import { CalendarClock, EyeOff, FolderKanban, Gauge, Target, TriangleAlert } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { MAJOR_DEVIATION, SNAPSHOT_HORIZON_DAYS } from "@/features/analytics/forecasting/constants";
import { accuracyReport } from "@/features/analytics/forecasting/server/snapshots";
import { AccuracyByKeyList, AccuracyTable } from "@/features/analytics/forecasting/components/accuracy-table";
import { AccuracyChart } from "@/features/analytics/forecasting/components/charts";
import { MethodNote, NotRecorded } from "@/features/analytics/forecasting/components/notes";
import { SaveForecastButton } from "@/features/analytics/forecasting/components/save-forecast-button";
import { isMajorDifference, plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Forecast vs actual" };

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export default async function ForecastAccuracyPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  // Project cost forecasts include salaries, so only admins see them.
  const report = await accuracyReport({ includeProjects: isAdmin });

  const header = (
    <PageHeader
      eyebrow="Analytics & Planning"
      title="Forecast vs actual"
      description="Forecasts stored each month, checked against what was recorded once their period ended. Shows how far the forecasts can be trusted."
      actions={<SaveForecastButton />}
    />
  );
  const pendingCount = report.pending.material + report.pending.project;

  if (report.rows.length === 0) {
    return (
      <Page>
        {header}
        <EmptyState
          icon={Target}
          title={report.stored === 0 ? "No forecasts stored yet" : "No forecast period has ended yet"}
          description={
            report.stored === 0
              ? "A forecast is stored the first time each month the demand forecast or project cost forecast page is opened. Comparisons appear here once the first stored forecast's period has ended, about a month later."
              : `${plural(pendingCount, "forecast")} stored so far. The first comparison appears on ${report.pending.nextCheck ? formatDate(report.pending.nextCheck) : "the end of its period"}, when its period ends.`
          }
        />
        {!isAdmin ? <MemberNote /> : null}
      </Page>
    );
  }

  const materials = report.rows.filter((r) => r.kind === "material_demand");
  const projects = report.rows.filter((r) => r.kind === "project_cost");
  const major = report.rows.filter(isMajorDifference);
  const materialAccuracy = mean(materials.map((r) => r.accuracy));
  const projectAccuracy = mean(projects.map((r) => r.accuracy));

  return (
    <Page>
      {header}
      <StatGrid>
        <StatCard
          label="Material demand accuracy"
          icon={Gauge}
          tone="brand"
          value={materialAccuracy === null ? "-" : formatPercent(materialAccuracy)}
          hint={materials.length ? `Mean over ${plural(materials.length, "comparison")}` : "No material comparisons yet"}
        />
        {isAdmin ? (
          <StatCard
            label="Project cost accuracy"
            icon={FolderKanban}
            tone="info"
            value={projectAccuracy === null ? "-" : formatPercent(projectAccuracy)}
            hint={projects.length ? `Mean over ${plural(projects.length, "comparison")}` : "Checked at each project's planned end"}
          />
        ) : null}
        <StatCard
          label="Major differences"
          icon={TriangleAlert}
          tone={major.length ? "warning" : "success"}
          value={formatNumber(major.length)}
          hint={`Off by more than ${formatPercent(MAJOR_DEVIATION)}`}
        />
        <StatCard
          label="Waiting to be checked"
          icon={CalendarClock}
          tone="default"
          value={formatNumber(pendingCount)}
          hint={report.pending.nextCheck ? `Next on ${formatDate(report.pending.nextCheck)}` : "None waiting"}
        />
      </StatGrid>

      <MethodNote>
        <p>
          <span className="font-medium text-foreground">How this is worked out.</span> Material forecasts are the units expected in the {SNAPSHOT_HORIZON_DAYS} days after
          the forecast was stored; the actual is units assigned less returned in those same days. Project forecasts are the predicted total cost; the actual is the spend
          recorded up to the planned end date as it stood then.
        </p>
        <p>
          Difference = actual − forecast. Deviation = difference ÷ forecast. Accuracy = 100% − the size of the deviation, never below 0%. A stored forecast is never changed
          afterwards.
        </p>
      </MethodNote>

      <Section title="Accuracy over time" description="Mean accuracy of the forecasts made in each month.">
        <AccuracyChart months={report.byMonth} showProjects={isAdmin && projects.length > 0} />
      </Section>

      <Section title="All comparisons" description="Largest deviation first.">
        <AccuracyTable rows={report.rows} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Material-wise accuracy" description="Least accurate first.">
          {materials.length ? (
            <AccuracyByKeyList rows={report.byKey.filter((k) => k.kind === "material_demand")} />
          ) : (
            <EmptyState compact icon={Gauge} title="No material comparisons yet" description="They appear once a stored material forecast's 30 days have passed." />
          )}
        </Section>
        {isAdmin ? (
          <Section title="Project-wise accuracy" description="Least accurate first.">
            {projects.length ? (
              <AccuracyByKeyList rows={report.byKey.filter((k) => k.kind === "project_cost")} />
            ) : (
              <EmptyState compact icon={FolderKanban} title="No project comparisons yet" description="A project forecast is checked on the project's planned end date." />
            )}
          </Section>
        ) : (
          <MemberNote />
        )}
      </div>

      <NotRecorded title="Reasons for major differences">
        Causes such as a delayed project, a design change or a bulk order are not recorded with forecasts, so differences are shown without a reason.
      </NotRecorded>
    </Page>
  );
}

function MemberNote() {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
      <EyeOff className="size-4 shrink-0" aria-hidden />
      Project cost forecasts include salaries, so only admins see their comparisons.
    </p>
  );
}
