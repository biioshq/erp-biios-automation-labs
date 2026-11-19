import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Landmark, PauseCircle, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/server/auth/session";
import { getEmployeeOptions, getProjectOptions, getVendorNames } from "@/server/lookups";
import { getRecurringSummary, listRecurring } from "@/features/finance/recurring/queries";
import { RECURRING_FILTER_KEYS, RECURRING_SORT_KEYS } from "@/features/finance/recurring/schemas";
import { RecurringView } from "@/features/finance/recurring/components/recurring-view";

export const metadata: Metadata = { title: "Recurring expenses" };

export default async function RecurringPage({ searchParams }: PageProps<"/finance/recurring">) {
  const params = parseListParams(await searchParams, {
    filterKeys: RECURRING_FILTER_KEYS,
    sortable: RECURRING_SORT_KEYS,
    defaultSort: { id: "nextRunDate", desc: false },
  });
  const [data, summary, projects, vendors, employees, user] = await Promise.all([
    listRecurring(params),
    getRecurringSummary(),
    getProjectOptions(),
    getVendorNames(),
    getEmployeeOptions(),
    getCurrentUser(),
  ]);
  const isAdmin = user?.role === "admin";

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Recurring expenses"
        description="Salaries, rent, bills and subscriptions that post themselves on their due dates."
        actions={
          isAdmin ? (
            <Button asChild className="max-sm:w-full">
              <Link href="?new=1" scroll={false}>
                <Plus /> New schedule
              </Link>
            </Button>
          ) : undefined
        }
      />

      <StatGrid className="grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          label="Committed per month"
          icon={Repeat}
          tone="brand"
          value={<Money value={summary.committedMonthly} compact />}
          hint={`${formatNumber(summary.activeCount)} active schedule${summary.activeCount === 1 ? "" : "s"}`}
          className="p-4 sm:p-5"
        />
        <StatCard
          label="Salaries per month"
          icon={Landmark}
          value={<Money value={summary.salariesMonthly} compact />}
          hint="Active salary schedules"
          className="p-4 sm:p-5"
        />
        <StatCard
          label="Due in 30 days"
          icon={CalendarClock}
          tone={summary.dueCount ? "warning" : "default"}
          value={<Money value={summary.dueAmount} compact />}
          hint={`${formatNumber(summary.dueCount)} expense${summary.dueCount === 1 ? "" : "s"} to post`}
          className="p-4 sm:p-5"
        />
        <StatCard
          label="Paused"
          icon={PauseCircle}
          value={formatNumber(summary.pausedCount)}
          hint={summary.pausedCount ? "Not posting until resumed" : "Nothing paused"}
          className="p-4 sm:p-5"
        />
      </StatGrid>

      <RecurringView data={data} summary={summary} projects={projects} vendors={vendors} employees={employees} />
    </Page>
  );
}
