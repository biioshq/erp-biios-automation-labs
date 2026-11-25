import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, CalendarHeart, CalendarX, Eye, Lock, UserCheck, UserX, Users, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { dateInput } from "@/lib/zod";
import { formatNumber } from "@/lib/format";
import { isLate } from "@/features/hr/salary/calc";
import { todayIST } from "@/features/hr/server";
import { PeriodNav } from "@/features/hr/components/period-nav";
import { getDailySheet } from "@/features/hr/attendance/queries";
import { DailySheetView } from "@/features/hr/attendance/components/daily-sheet";

export const metadata: Metadata = { title: "Daily attendance" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** "2026-11-25" plus n days. */
function shiftDay(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "Wed, 25 Nov 2026" */
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "November 2026" */
function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default async function DailyAttendancePage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "hr.attendance:view")) return <NoAccess eyebrow="HR" title="Daily attendance" />;

  const sp = await searchParams;
  const today = todayIST();
  const parsed = dateInput.safeParse(first(sp.date));
  const date = parsed.success ? parsed.data : today;
  const sheet = await getDailySheet(date, user);

  // The day's numbers, from saved marks only.
  const counts = { present: 0, halfDay: 0, absent: 0, leave: 0, late: 0, unmarked: 0, off: 0 };
  for (const r of sheet.rows) {
    const m = r.mark;
    if (!m) {
      counts.unmarked += 1;
      continue;
    }
    if (m.status === "present") counts.present += 1;
    else if (m.status === "half_day") counts.halfDay += 1;
    else if (m.status === "absent") counts.absent += 1;
    else if (m.status === "leave") counts.leave += 1;
    else counts.off += 1;
    // Late as the salary counts it: a full day at work on a working day, in after the start plus grace.
    if (m.status === "present" && sheet.kind === "working" && isLate(m.inTime, sheet.rules)) counts.late += 1;
  }
  const offDay = sheet.kind !== "working";
  const canMark = sheet.can.create || sheet.can.edit || sheet.can.delete;
  const canViewEmployees = can(user, "finance.employees:view");

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="Daily attendance"
        description="Mark who came in, their in and out times, and who was absent or on leave. Salaries are worked out from these marks."
        actions={
          <>
            {canViewEmployees ? (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href="/finance/employees">
                  <UsersRound /> Employees
                </Link>
              </Button>
            ) : null}
            {can(user, "hr.leaves:create") ? (
              <Button asChild className="w-full sm:w-auto">
                <Link href="/hr/attendance/leaves?new=1">
                  <CalendarX /> Record leave
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <PeriodNav kind="date" value={date} prev={shiftDay(date, -1)} next={shiftDay(date, 1)} label={dayLabel(date)} todayValue={today} />

      {sheet.kind === "holiday" ? (
        <Alert role="status" className="border-chart-4/30 bg-chart-4/8">
          <CalendarHeart />
          <AlertTitle>Holiday{sheet.holidayName ? `: ${sheet.holidayName}` : ""}</AlertTitle>
          <AlertDescription>This day is paid for everyone. Mark only the people who came in to work.</AlertDescription>
        </Alert>
      ) : sheet.kind === "week_off" ? (
        <Alert role="status" className="bg-muted/50">
          <CalendarClock />
          <AlertTitle>Weekly off</AlertTitle>
          <AlertDescription>This day is paid for everyone. Mark only the people who came in to work.</AlertDescription>
        </Alert>
      ) : null}

      {sheet.locked ? (
        <Alert role="status" className="border-warning/30 bg-warning/8">
          <Lock />
          <AlertTitle>{monthLabel(sheet.month)} is locked</AlertTitle>
          <AlertDescription>
            <p>
              The salary for this month is finalised, so its attendance cannot change.{" "}
              <Link href={`/hr/attendance/salary?month=${sheet.month}`}>Open the salary for {monthLabel(sheet.month)}</Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : sheet.future && canMark ? (
        <Alert role="status">
          <CalendarClock />
          <AlertTitle>This day is still to come</AlertTitle>
          <AlertDescription>You can mark leave, holidays and weekly offs ahead. Presence and times can be marked on the day.</AlertDescription>
        </Alert>
      ) : !canMark ? (
        <Alert role="status">
          <Eye />
          <AlertTitle>View only</AlertTitle>
          <AlertDescription>Your role can see attendance but not mark it. Ask an admin if you need to.</AlertDescription>
        </Alert>
      ) : null}

      <StatGrid className="lg:grid-cols-3 xl:grid-cols-6">
        <StatCard compact label="Employees" icon={Users} tone="brand" value={formatNumber(sheet.rows.length)} hint="Employed on this day" />
        <StatCard
          compact
          label="Present"
          icon={UserCheck}
          tone="success"
          value={formatNumber(counts.present)}
          hint={counts.halfDay ? `and ${plural(counts.halfDay, "half day", "half days")}` : "No half days"}
        />
        <StatCard compact label="Absent" icon={UserX} tone="danger" value={formatNumber(counts.absent)} />
        <StatCard compact label="On leave" icon={CalendarX} tone="info" value={formatNumber(counts.leave)} hint={counts.off ? `${plural(counts.off, "person", "people")} marked off` : undefined} />
        <StatCard compact label="Late" icon={AlarmClock} tone="warning" value={formatNumber(counts.late)} hint={`After ${sheet.rules.workStart} plus ${sheet.rules.graceMinutes} min`} />
        <StatCard
          compact
          label="Not marked"
          icon={CalendarClock}
          value={formatNumber(counts.unmarked)}
          hint={offDay ? (sheet.kind === "holiday" ? "Holiday, paid" : "Weekly off, paid") : counts.unmarked ? "Still to mark" : "Everyone marked"}
        />
      </StatGrid>

      <DailySheetView key={date} sheet={sheet} canViewEmployees={canViewEmployees} />
    </Page>
  );
}
