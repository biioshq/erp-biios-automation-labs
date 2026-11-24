import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { SCENARIO_TYPES, labelOf, type ScenarioType } from "@/lib/constants";
import { requireUser } from "@/server/auth/session";
import { getScenarioFormOptions } from "@/features/analytics/scenarios/queries";
import { scenarioTypeSchema } from "@/features/analytics/scenarios/schemas";
import { SCENARIO_TYPE_META } from "@/features/analytics/scenarios/components/badges";
import { ScenarioTypePicker } from "@/features/analytics/scenarios/components/type-picker";
import { ScenarioForm } from "@/features/analytics/scenarios/components/form/scenario-form";

export const metadata: Metadata = { title: "New scenario" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewScenarioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  const parsed = scenarioTypeSchema.safeParse(first((await searchParams).type));

  if (!parsed.success) {
    return (
      <Page>
        <PageHeader
          eyebrow="Analytics & Planning"
          title="New scenario"
          description="Pick what you want to try out. Scenarios read today's records and keep their own figures; they never change stock, budgets, purchases, people or money."
        />
        <ScenarioTypePicker />
      </Page>
    );
  }

  const type: ScenarioType = parsed.data;
  const options = await getScenarioFormOptions({ admin: user.role === "admin" });
  return (
    <Page>
      <PageHeader
        eyebrow="New scenario"
        title={labelOf(SCENARIO_TYPES, type)}
        description={SCENARIO_TYPE_META[type].summary}
        actions={
          <Button asChild variant="outline">
            <Link href="/analytics/scenarios/new">
              <ArrowLeft /> Other types
            </Link>
          </Button>
        }
      />
      <ScenarioForm type={type} options={options} isAdmin={user.role === "admin"} />
    </Page>
  );
}
