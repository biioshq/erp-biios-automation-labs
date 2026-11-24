import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, FolderKanban, PackageCheck, Search, ShieldCheck, Trash2, Undo2, Users, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatNumber, formatPercent } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { ANALYTICS } from "@/features/analytics/links";
import { userCanOpen } from "@/features/analytics/viewer";
import { idParam } from "@/features/analytics/inventory/params";
import { statusesParam, sumOf } from "@/features/analytics/projects/model";
import { getResources } from "@/features/analytics/projects/resource-queries";
import { NotRecorded, RuleNote, plural } from "@/features/analytics/inventory/components/table-kit";
import { ProjectPicker, ProjectStatusSelect } from "@/features/analytics/projects/components/project-filter";
import {
  EquipmentTable,
  ManpowerByProjectTable,
  MaterialLinesTable,
  MaterialsByProjectTable,
  PeopleLoadTable,
} from "@/features/analytics/projects/components/resource-sections";

export const metadata: Metadata = { title: "Resource utilisation" };

const LEVEL_LABEL = { out: "Out of stock", below_min: "At or below minimum", runs_out: "Runs out soon" } as const;

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, ANALYTICS.projects)) return <NoAccess eyebrow="Analytics & Planning" title="Resource utilisation" />;
  // Links show only when their page can be opened.
  const open = (href: string) => userCanOpen(user, href);
  const sp = await searchParams;
  const statuses = statusesParam(sp);
  const data = await getResources(statuses);
  const rows = data.projects;
  const withMaterials = rows.filter((r) => r.materials.items > 0);
  const picked = idParam(sp, "project");
  const fallback = withMaterials[0]?.id ?? "";
  const selected = rows.find((r) => r.id === picked) ?? rows.find((r) => r.id === fallback) ?? null;
  const returned = sumOf(rows, (r) => r.materials.returned);
  const movedOut = sumOf(rows, (r) => r.materials.movedOut);
  // Stock moved between projects is allocated on both projects; counted once here, from storage.
  const issued = data.issuedFromStorage;
  const wasted = sumOf(rows, (r) => r.materials.wasted);
  const inUse = sumOf(rows, (r) => r.materials.inUse);
  const equipment = rows.flatMap((r) => r.equipment.map((e) => ({ ...e, projectId: r.id, projectName: r.name, color: r.color })));
  const fte = Math.round(rows.reduce((s, r) => s + r.fte, 0) * 100) / 100;
  const overAllocated = data.people.filter((p) => p.totalAllocation > 100);
  const shortages = rows.filter((r) => r.shortages.length);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Resource utilisation"
        description="Materials, equipment and people each project holds, how much of the stock came back or was wasted, and where resources run short."
        actions={
          <>
            <ProjectStatusSelect statuses={statuses} />
            {open("/finance/employees") ? (
              <Button asChild variant="outline">
                <Link href="/finance/employees">
                  <Users /> Employees
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {data.total === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" description="Create a project, assign stock and people to it, and its resources show here." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title="No projects with this status" description="Pick another status to see those projects." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Materials in use" icon={PackageCheck} tone="brand" value={<Money value={inUse} />} hint={<>Of <Money value={issued} /> issued from storage</>} />
            <StatCard
              label="Returned to storage"
              icon={Undo2}
              tone="info"
              value={<Money value={returned} />}
              hint={
                issued > 0 ? (
                  <>
                    {formatPercent(returned / issued)} of issued{movedOut > 0 ? <>; <Money value={movedOut} /> moved between projects</> : null}
                  </>
                ) : (
                  "Nothing issued"
                )
              }
            />
            <StatCard label="Wasted on site" icon={Trash2} tone={wasted > 0 ? "danger" : "default"} value={<Money value={wasted} />} hint={issued > 0 ? `${formatPercent(wasted / issued)} of issued` : "Nothing issued"} />
            <StatCard
              label="People allocated"
              icon={Users}
              tone={overAllocated.length ? "warning" : "default"}
              value={formatNumber(fte)}
              hint={overAllocated.length ? `Full-time equivalent; ${plural(overAllocated.length, "person", "people")} over 100%` : "Full-time equivalent"}
            />
          </StatGrid>

          <Section
            title="Materials: allocated against consumed"
            description="Stock allocated to each project at the cost it was assigned at (moves from another project included), what went back to storage or on to another project, what was wasted on site and what is still in use."
            contentClassName="p-0 sm:p-0"
          >
            {withMaterials.length ? (
              <MaterialsByProjectTable rows={withMaterials} />
            ) : (
              <EmptyState compact className="m-4" icon={Boxes} title="No stock assigned to these projects" />
            )}
          </Section>

          {selected ? (
            <Section
              title={`Materials on ${selected.name}`}
              description="Each material allocated to the project, in units."
              actions={
                <ProjectPicker
                  value={selected.id}
                  fallback={fallback}
                  options={(withMaterials.length ? withMaterials : rows)
                    .concat(withMaterials.length && !withMaterials.includes(selected) ? [selected] : [])
                    .map((r) => ({ value: r.id, label: r.name }))}
                />
              }
              contentClassName={selected.materialLines.length ? "p-0 sm:p-0" : undefined}
            >
              {selected.materialLines.length ? (
                <MaterialLinesTable rows={selected.materialLines} />
              ) : (
                <EmptyState compact icon={Boxes} title="No stock assigned to this project" />
              )}
            </Section>
          ) : null}

          <NotRecorded title="Unused or excess stock">
            Stock held by a project is counted as used: installation is not recorded separately, and the ERP does not record stock that sits on site
            unused. Returns and write-offs are the recorded signs of excess, shown as shares of what was allocated above.
          </NotRecorded>

          <Section title="Equipment on projects" description="Fixed assets placed with each project." contentClassName={equipment.length ? "p-0 sm:p-0" : undefined}>
            {equipment.length ? (
              <EquipmentTable rows={equipment} linkAssets={can(user, "finance.fixed_assets:view") && can(user, ANALYTICS.financialPosition)} />
            ) : (
              <EmptyState compact icon={Wrench} title="No equipment placed with these projects" description="Set the project on a fixed asset to show it here." />
            )}
          </Section>

          <Section title="Manpower by project" description="Open memberships with each person's share of time, and open tasks." contentClassName="p-0 sm:p-0">
            <ManpowerByProjectTable rows={rows} />
          </Section>

          <Section
            title="People and their load"
            description="Everyone on an open project, with their allocation added up across open projects. Open tasks count the projects shown."
            contentClassName={data.people.length ? "p-0 sm:p-0" : undefined}
          >
            {data.people.length ? <PeopleLoadTable rows={data.people} /> : <EmptyState compact icon={Users} title="No one is assigned to an open project" />}
          </Section>

          <NotRecorded title="Utilisation of equipment and people">
            Hours of use are not recorded for equipment, and time spent is not recorded for people (there are no timesheets). Allocation shares and open tasks
            are what the ERP holds, so utilisation is shown as those.
          </NotRecorded>

          <Section title="Shortages" description="Materials at risk (out, below minimum or running out soon) that a project used in the last 90 days.">
            {shortages.length ? (
              <ul className="divide-y">
                {shortages.map((r) => (
                  <li key={r.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                    <Link href={`/finance/projects/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      {r.shortages.map((s) => (
                        <Link key={s.id} href={`/inventory/items/${s.id}`} title={s.reasons.join(". ")}>
                          <Badge variant="secondary" className={s.level === "out" ? "bg-danger/10 text-danger" : "bg-warning/12 text-warning"}>
                            {s.name}: {LEVEL_LABEL[s.level]}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={ShieldCheck} title="No project is short of a material it uses" />
            )}
          </Section>
          <RuleNote>
            A person over 100% is allocated to more open projects than their time allows. Shortage risk uses the same rule as the inventory alerts;{" "}
            <Link href="/analytics/inventory/shortages" className="underline underline-offset-2">
              see Shortage risk
            </Link>
            .
          </RuleNote>
        </>
      )}
    </Page>
  );
}
