import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, History, IndianRupee, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber, round2 } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { MAINTENANCE_LOOKAHEAD, WARRANTY_SOON_DAYS } from "@/features/analytics/forecasting/constants";
import { equipmentOutlook } from "@/features/analytics/forecasting/server/maintenance";
import { EquipmentTable } from "@/features/analytics/forecasting/components/equipment-table";
import { MethodNote, NotRecorded } from "@/features/analytics/forecasting/components/notes";
import { plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Equipment maintenance forecast" };

const [SOON, LATER] = MAINTENANCE_LOOKAHEAD;

export default async function MaintenanceForecastPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const rows = await equipmentOutlook();

  const header = (
    <PageHeader
      eyebrow="Analytics & Planning"
      title="Equipment maintenance"
      description="When each piece of equipment is next due for service, from the maintenance recorded in the fixed asset register, and what needs attention now."
      actions={
        <Button asChild variant="outline">
          <Link href="/finance/assets/fixed">Fixed assets</Link>
        </Button>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <Page>
        {header}
        <EmptyState
          icon={Wrench}
          title="No equipment recorded"
          description="Equipment is a fixed asset marked as equipment, or filed under plant and machinery, computers and electronics, or vehicles. Add one with its maintenance history to see when service is due."
          action={
            <Button asChild>
              <Link href="/finance/assets/fixed?new=1">Add a fixed asset</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const due = (days: number) => rows.filter((r) => r.dueIn !== null && r.dueIn >= 0 && r.dueIn <= days);
  const dueSoon = due(SOON);
  const dueLater = due(LATER);
  const overdue = rows.filter((r) => r.dueIn !== null && r.dueIn < 0);
  const attention = rows.filter((r) => r.attention.length);
  const costed = [...overdue, ...dueLater].filter((r) => r.averageCost !== null);
  const expectedCost = round2(costed.reduce((s, r) => s + (r.averageCost ?? 0), 0));
  const noForecast = rows.filter((r) => !r.nextDue).length;
  const upcoming = [...overdue, ...dueLater].sort((a, b) => (a.dueIn ?? 0) - (b.dueIn ?? 0));
  const history = rows
    .flatMap((r) => r.history.map((h) => ({ ...h, equipmentId: r.id, equipment: r.name })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);

  return (
    <Page>
      {header}
      <StatGrid>
        <StatCard label="Equipment" icon={Wrench} tone="default" value={formatNumber(rows.length)} hint={noForecast ? `${plural(noForecast, "item")} without enough service history` : "All have a next service date"} />
        <StatCard
          label={`Due in ${SOON} days`}
          icon={CalendarClock}
          tone={dueSoon.length || overdue.length ? "warning" : "success"}
          value={formatNumber(dueSoon.length)}
          hint={overdue.length ? `${formatNumber(overdue.length)} overdue as well` : `${formatNumber(dueLater.length)} within ${LATER} days`}
        />
        <StatCard label="Needs attention" icon={TriangleAlert} tone={attention.length ? "danger" : "success"} value={formatNumber(attention.length)} hint="Overdue, damaged, in service or warranty ending" />
        <StatCard
          label={`Expected service cost, ${LATER} days`}
          icon={IndianRupee}
          tone="info"
          value={<Money value={expectedCost} compact />}
          hint={costed.length ? `Average past cost of ${plural(costed.length, "service")} due or overdue` : "No past costs recorded for what is due"}
        />
      </StatGrid>

      <MethodNote>
        <p>
          <span className="font-medium text-foreground">How this is worked out.</span> The next service is the due date recorded with the latest maintenance entry. Without
          one, it is the last service plus the average gap between recorded services, which needs at least two. With fewer, no date is predicted.
        </p>
        <p>
          Needs attention: service overdue, condition marked damaged or under maintenance, or warranty ending within {WARRANTY_SOON_DAYS} days. Expected cost uses each
          item&apos;s average recorded service cost; a booked cost is taken from its expense.
        </p>
      </MethodNote>
      <NotRecorded title="Usage hours">Running hours are not recorded, so service dates come from time and recorded entries only, never from usage.</NotRecorded>

      <Section title={`Due within ${LATER} days`} description="Overdue first, then by due date.">
        {upcoming.length ? (
          <ul className="divide-y">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/finance/assets/fixed?view=${r.id}`} className="min-w-0 truncate font-medium hover:underline">
                  {r.name} <span className="font-mono text-xs font-normal text-muted-foreground">{r.code}</span>
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.dueIn !== null && r.dueIn < 0 ? <span className="font-medium text-danger">{-r.dueIn} days overdue</span> : `Due ${formatDate(r.nextDue)}`}
                  {r.averageCost !== null ? <> · about <Money value={r.averageCost} /></> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={CalendarClock} title={`Nothing due in the next ${LATER} days`} description="Equipment without enough service history has no due date; see the table." />
        )}
      </Section>

      <Section title="All equipment" description="Select a row to open it in the fixed asset register.">
        <EquipmentTable rows={rows} />
      </Section>

      <Section title="Recent maintenance" description="The latest services recorded across all equipment.">
        {history.length ? (
          <ul className="divide-y">
            {history.map((h, i) => (
              <li key={`${h.equipmentId}-${h.date}-${i}`} className="flex flex-col gap-1 py-2.5 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="font-medium">{h.equipment}</span> · {h.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(h.date)}
                    {h.vendor ? ` · ${h.vendor}` : ""}
                    {h.nextDueDate ? ` · next due ${formatDate(h.nextDueDate)}` : ""}
                  </p>
                </div>
                {h.cost > 0 ? <Money value={h.cost} className="shrink-0" /> : <span className="shrink-0 text-xs text-muted-foreground">No cost</span>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={History} title="No maintenance recorded yet" description="Record services on each asset in the fixed asset register." />
        )}
      </Section>
    </Page>
  );
}
