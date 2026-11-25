import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { NoAccess } from "@/components/shared/no-access";
import { formatNumber } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { PeriodNav } from "@/features/hr/components/period-nav";
import { monthInput } from "@/features/hr/schemas";
import { monthOf, todayIST } from "@/features/hr/server";
import { addMonths } from "@/features/hr/salary/calc";
import { getRegister } from "@/features/hr/register/queries";
import { RegisterGrid } from "@/features/hr/register/components/register-grid";
import { RegisterLegend } from "@/features/hr/register/components/register-legend";
import { RegisterDownload } from "@/features/hr/register/components/register-download";

export const metadata: Metadata = { title: "Monthly register" };

/** The month from ?month=YYYY-MM, or this month when it is missing or not a sensible month. */
function pickMonth(value: string | string[] | undefined, fallback: string): string {
  const parsed = monthInput.safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) return fallback;
  const year = Number(parsed.data.slice(0, 4));
  return year >= 2000 && year <= 2100 ? parsed.data : fallback;
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "hr.attendance:view")) return <NoAccess eyebrow="HR" title="Monthly register" />;

  const sp = await searchParams;
  const thisMonth = monthOf(todayIST());
  const month = pickMonth(sp.month, thisMonth);
  const register = await getRegister(month);
  const people = register.rows.length;

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="Monthly register"
        description="Everyone's attendance for the month, one column a day. Select a day to open it on the daily sheet."
        actions={can(user, "hr.attendance:export") && people ? <RegisterDownload month={month} label={register.label} /> : null}
      />

      <PeriodNav
        kind="month"
        value={month}
        prev={addMonths(month, -1)}
        next={month < thisMonth ? addMonths(month, 1) : null}
        label={register.label}
        todayValue={thisMonth}
      />

      {register.locked ? (
        <Alert className="border-info/40 bg-info/5">
          <Lock className="text-info" />
          <AlertTitle>{register.label} is finalised</AlertTitle>
          <AlertDescription>
            The salary for this month is final, so its attendance is locked. To change a day, reopen the month on the Salary tab first.
          </AlertDescription>
        </Alert>
      ) : null}

      {people ? (
        <>
          <Section
            title={register.label}
            description={`${formatNumber(people)} ${people === 1 ? "person" : "people"}, ${formatNumber(register.workingDays)} working ${register.workingDays === 1 ? "day" : "days"}`}
            contentClassName="p-0"
          >
            <RegisterGrid register={register} />
          </Section>
          <Section title="Legend">
            <RegisterLegend register={register} />
          </Section>
        </>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title={`Nobody was employed in ${register.label}`}
          description="The register lists everyone on the Employees page who worked here on at least one day of the month. Check their join and exit dates if someone is missing."
          action={
            can(user, "finance.employees:view") ? (
              <Button asChild variant="outline">
                <Link href="/finance/employees">Open employees</Link>
              </Button>
            ) : null
          }
        />
      )}
    </Page>
  );
}
