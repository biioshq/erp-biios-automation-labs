import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, CalendarOff, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { NoAccess } from "@/components/shared/no-access";
import { formatNumber } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { getHrRules, monthOf, todayIST } from "@/features/hr/server";
import { addMonths, leaveYearLabel, leaveYearStart } from "@/features/hr/salary/calc";
import { leaveYearRange } from "@/features/hr/leaves/plan";
import { leaveBalances, leaveEmployees, listLeaveRuns, onLeaveOn } from "@/features/hr/leaves/queries";
import { LeavesToolbar } from "@/features/hr/leaves/components/leaves-toolbar";
import { LeaveRuns } from "@/features/hr/leaves/components/leave-runs";
import { LeaveBalancesTable } from "@/features/hr/leaves/components/leave-balances";
import { LeaveSheet } from "@/features/hr/leaves/components/leave-sheet";

export const metadata: Metadata = { title: "Leaves" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;

export default async function LeavesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "hr.leaves:view")) return <NoAccess eyebrow="HR" title="Leaves" />;
  const sp = await searchParams;
  const { rules } = await getHrRules();
  const today = todayIST();

  // The leave year: ?year= is its first month; any month in it is moved to the start.
  const startMonth = rules.leaveYearStartMonth;
  const currentYear = leaveYearStart(monthOf(today), startMonth);
  const yearParam = first(sp.year);
  const yearStart = yearParam && MONTH.test(yearParam) ? leaveYearStart(yearParam, startMonth) : currentYear;
  const range = leaveYearRange(yearStart);
  const yearLabel = leaveYearLabel(yearStart, startMonth);
  const prevYear = addMonths(yearStart, -12);
  const nextYear = addMonths(yearStart, 12) <= addMonths(currentYear, 12) ? addMonths(yearStart, 12) : null;

  const employeeParam = first(sp.employee);
  const employeeId = employeeParam && OBJECT_ID.test(employeeParam) ? employeeParam : null;
  const canCreate = can(user, "hr.leaves:create");
  const canDelete = can(user, "hr.leaves:delete");
  // Replacing days already marked on the daily sheet changes marked attendance (recordLeave checks it too).
  const canReplace = can(user, "hr.attendance:edit");
  const recordHref = `?${new URLSearchParams({ ...(yearParam ? { year: yearStart } : {}), ...(employeeId ? { employee: employeeId } : {}), new: "1" }).toString()}`;

  // The record leave picker covers this leave year and the current one, so leave can be recorded
  // for today even while an earlier year is open. The server checks employment for every day.
  const current = leaveYearRange(currentYear);
  const pickerFrom = range.from < current.from ? range.from : current.from;
  const pickerTo = range.to > current.to ? range.to : current.to;

  const [runs, balances, people, pickerPeople, onLeaveToday] = await Promise.all([
    listLeaveRuns({ from: range.from, to: range.to, rules, employeeId }),
    leaveBalances({ from: range.from, to: range.to, rules, employeeId }),
    leaveEmployees(range.from, range.to),
    canCreate ? leaveEmployees(pickerFrom, pickerTo) : Promise.resolve([]),
    onLeaveOn(today, employeeId),
  ]);
  const filterPeople = employeeId && !people.some((p) => p.id === employeeId) ? [...people, ...pickerPeople.filter((p) => p.id === employeeId)] : people;

  const totalDays = runs.reduce((sum, r) => sum + r.days, 0);
  const overAllowance = balances.rows.filter((r) =>
    balances.types.some((t) => t.known && t.yearlyQuota !== null && (r.used[t.code] ?? 0) > t.yearlyQuota),
  ).length;

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="Leaves"
        description="Leave taken by each person, and how much of each yearly allowance is left."
        actions={
          canCreate ? (
            <Button asChild className="w-full sm:w-auto">
              <Link href={recordHref} scroll={false}>
                <Plus /> Record leave
              </Link>
            </Button>
          ) : null
        }
      />

      <LeavesToolbar
        yearStart={yearStart}
        yearLabel={yearLabel}
        prevYear={prevYear}
        nextYear={nextYear}
        currentYear={currentYear}
        employees={filterPeople}
        employeeId={employeeId}
      />

      <StatGrid className="grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <StatCard
          label="Leave days"
          icon={CalendarOff}
          tone="info"
          value={formatNumber(totalDays)}
          hint={`${formatNumber(runs.length)} ${runs.length === 1 ? "record" : "records"} in ${yearLabel}`}
          className="p-4 sm:p-5"
        />
        <StatCard
          label="On leave today"
          icon={CalendarCheck}
          tone="brand"
          value={formatNumber(onLeaveToday)}
          hint={onLeaveToday === 1 ? "Person, full or half day" : "People, full or half day"}
          className="p-4 sm:p-5"
        />
        <StatCard
          label="Over the allowance"
          icon={TriangleAlert}
          tone={overAllowance ? "danger" : "default"}
          value={formatNumber(overAllowance)}
          hint="Past a yearly allowance"
          className="col-span-2 p-4 sm:p-5 xl:col-span-1"
        />
      </StatGrid>

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="leave-records">
        <div className="min-w-0">
          <h2 id="leave-records" className="text-[15px] font-semibold tracking-tight">
            Leave records
          </h2>
          <p className="text-xs text-pretty text-muted-foreground">
            Newest first. Leave marked on the daily sheet shows here too; a half day of leave counts as half a day.
          </p>
        </div>
        <LeaveRuns runs={runs} canDelete={canDelete} canCreate={canCreate} recordHref={recordHref} filtered={Boolean(employeeId)} yearLabel={yearLabel} />
      </section>

      <Section
        title={`Balances for ${yearLabel}`}
        description="Days used of each leave type, against its yearly allowance. Paid leave past the allowance is not paid."
        contentClassName="p-0 sm:p-0"
      >
        <LeaveBalancesTable balances={balances} filtered={Boolean(employeeId)} />
      </Section>

      {canCreate ? <LeaveSheet employees={pickerPeople} leaveTypes={rules.leaveTypes} today={today} canReplace={canReplace} /> : null}
    </Page>
  );
}
