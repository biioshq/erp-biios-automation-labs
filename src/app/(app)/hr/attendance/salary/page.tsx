import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarX, Clock, EyeOff, IndianRupee, Lock, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { formatDateTime, formatNumber } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { monthInput } from "@/features/hr/schemas";
import { monthOf, todayIST } from "@/features/hr/server";
import { PeriodNav } from "@/features/hr/components/period-nav";
import { addMonths, formatMinutes } from "@/features/hr/salary/calc";
import { getSalaryMonth } from "@/features/hr/salary/queries";
import { monthLabel } from "@/features/hr/salary/types";
import { HowItWorks } from "@/features/hr/salary/components/how-it-works";
import { SalaryActions } from "@/features/hr/salary/components/salary-actions";
import { SalaryTable } from "@/features/hr/salary/components/salary-table";

export const metadata: Metadata = { title: "Salary from attendance" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SalaryFromAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "hr.salary:view")) return <NoAccess eyebrow="HR" title="Salary from attendance" />;

  const sp = await searchParams;
  const thisMonth = monthOf(todayIST());
  const raw = first(sp.month);
  const month = raw && monthInput.safeParse(raw).success ? raw : thisMonth;
  const withSalary = can(user, "data.salaries");
  const canApprove = can(user, "hr.salary:approve") && withSalary;
  const nav = (
    <PeriodNav kind="month" value={month} prev={addMonths(month, -1)} next={month < thisMonth ? addMonths(month, 1) : null} label={monthLabel(month)} todayValue={thisMonth} />
  );

  if (month > thisMonth) {
    return (
      <Page>
        <PageHeader eyebrow="HR" title="Salary from attendance" />
        {nav}
        <EmptyState
          icon={CalendarClock}
          title={`${monthLabel(month)} has not started yet`}
          description="Salary is worked out for this month and earlier months."
          action={
            <Button asChild variant="outline">
              <Link href={`?month=${thisMonth}`}>Go to this month</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const data = await getSalaryMonth(month, { withSalary });
  const { totals } = data;
  const monthOver = month < thisMonth;

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="Salary from attendance"
        description={`Each person's salary for ${monthLabel(month)}, worked out from attendance, leave and the attendance rules.`}
        actions={
          <SalaryActions
            month={month}
            canExport={can(user, "hr.salary:export")}
            canApprove={canApprove}
            finalised={data.finalised}
            monthOver={monthOver}
            hasLines={data.rows.length > 0}
          />
        }
      />

      {nav}

      {data.finalised && data.run ? (
        <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>
            Finalised{data.run.finalisedAt ? ` on ${formatDateTime(data.run.finalisedAt)}` : ""}
            {data.run.finalisedByName ? ` by ${data.run.finalisedByName}` : ""}. These are the lines saved then; attendance, leave and adjustments for this
            month are locked until someone reopens it.
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Worked out live from attendance.
          {monthOver ? "" : " The month is not over yet: days still to come are counted as paid."}
          {data.run?.status === "reopened" && data.run.reopenedAt
            ? ` Reopened on ${formatDateTime(data.run.reopenedAt)}${data.run.reopenedByName ? ` by ${data.run.reopenedByName}` : ""}.`
            : ""}
        </p>
      )}

      {!withSalary ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff className="size-3.5 shrink-0" aria-hidden />
          Amounts are hidden: your role does not include individual salaries. Days are shown in full.
        </p>
      ) : null}

      {data.rows.length ? (
        <StatGrid className={withSalary ? "xl:grid-cols-3" : undefined}>
          <StatCard label="People" icon={Users} tone="brand" value={formatNumber(totals.people)} hint={`Employed in ${monthLabel(month)}`} />
          {withSalary ? <StatCard label="Monthly salaries" icon={Wallet} value={<Money value={totals.monthlySalary} compact />} hint="Full month, before attendance" /> : null}
          <StatCard
            label="Loss of pay"
            icon={CalendarX}
            tone="danger"
            value={`${formatNumber(totals.lopDays)} ${totals.lopDays === 1 ? "day" : "days"}`}
            hint={withSalary ? <><Money value={totals.lopAmount} compact /> of pay lost</> : "Across everyone"}
          />
          {withSalary ? (
            <StatCard
              label="Overtime pay"
              icon={Clock}
              tone="info"
              value={<Money value={totals.overtimePay} compact />}
              hint={totals.overtimeMinutes ? `${formatMinutes(totals.overtimeMinutes)} worked` : "No overtime"}
            />
          ) : (
            <StatCard label="Overtime" icon={Clock} tone="info" value={formatMinutes(totals.overtimeMinutes) || "None"} hint="Hours past a full day" />
          )}
          {withSalary ? (
            <StatCard
              label="Net payable"
              icon={IndianRupee}
              tone="success"
              value={<Money value={totals.net} compact />}
              hint={data.bookedTotal !== null ? <>Booked in Expenses: <Money value={data.bookedTotal} compact /></> : undefined}
            />
          ) : null}
          <StatCard
            label="Days not marked"
            icon={CalendarClock}
            tone={totals.unmarked ? "warning" : "default"}
            value={formatNumber(totals.unmarked)}
            hint={totals.unmarked ? (data.rules.unmarkedDays === "unpaid" ? "Counted as absent" : "Counted as present") : "Every working day so far"}
          />
        </StatGrid>
      ) : null}

      <Section title="Salary lines" description="Click a person to see how their salary is worked out, day by day." contentClassName="p-0 sm:p-0">
        <SalaryTable
          rows={data.rows}
          totals={totals}
          bookedTotal={data.bookedTotal}
          rules={data.rules}
          withSalary={withSalary}
          canAdjust={canApprove && !data.finalised}
        />
      </Section>

      <HowItWorks
        rules={data.rules}
        month={month}
        finalised={data.finalised}
        rulesHref={can(user, "hr.settings:view") ? "/hr/attendance/rules" : null}
        withSalary={withSalary}
      />
    </Page>
  );
}
