import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/shared/page";
import { SCENARIO_TYPES, labelOf } from "@/lib/constants";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { analyticsViewer } from "@/features/analytics/viewer";
import { getScenarioDetail, getScenarioFormOptions } from "@/features/analytics/scenarios/queries";
import { ScenarioForm } from "@/features/analytics/scenarios/components/form/scenario-form";

export const metadata: Metadata = { title: "Edit scenario" };

export default async function EditScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.scenarios.edit)) return <NoAccess eyebrow="Analytics & Planning" title="Edit scenario" />;
  const viewer = analyticsViewer(user);
  const { id } = await params;
  const [scenario, options] = await Promise.all([getScenarioDetail(id, viewer), getScenarioFormOptions(viewer)]);
  if (!scenario) notFound();

  return (
    <Page>
      <PageHeader
        eyebrow={`Edit ${scenario.code}`}
        title={scenario.name}
        description={`${labelOf(SCENARIO_TYPES, scenario.type)}. Saving works the figures out again and records what changed in the history.${
          scenario.status === "approved" || scenario.status === "rejected" ? " Editing a decided scenario sends it back to Saved." : ""
        }`}
      />
      <ScenarioForm
        type={scenario.type}
        options={options}
        seesSalaries={viewer.salaries}
        initial={{ id: scenario.id, name: scenario.name, description: scenario.description, assumptions: scenario.assumptions, inputs: scenario.inputs, updatedAt: scenario.updatedAt }}
      />
    </Page>
  );
}
