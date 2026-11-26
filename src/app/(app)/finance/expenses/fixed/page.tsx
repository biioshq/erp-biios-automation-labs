import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, Lock } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { formatNumber } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { getFixedPayments } from "@/features/finance/expenses/fixed-queries";
import { FixedLoansTable, FixedSchedulesTable } from "@/features/finance/expenses/components/fixed-payments-view";

export const metadata: Metadata = { title: "Fixed payments" };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * Fixed financial commitments: loan instalments (Liabilities view) and recurring schedules marked
 * as fixed, rent by default (Recurring view). Each section shows only with its own permission.
 */
export default async function FixedPaymentsPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  const access = { loans: can(user, "finance.liabilities:view"), schedules: can(user, "finance.recurring:view") };
  if (!access.loans && !access.schedules) return <NoAccess title="Fixed payments" />;
  const data = await getFixedPayments(access);
  const s = data.summary;
  const seesSalaries = can(user, "data.salaries");

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Fixed payments"
        description={
          <>
            Payments the company is committed to make: loan instalments{access.schedules ? " and fixed recurring bills such as rent" : ""}. Nothing here
            is a new record; it reads{" "}
            {access.loans ? (
              <Link href="/finance/liabilities/loans" className="font-medium text-foreground hover:underline">
                Loans
              </Link>
            ) : null}
            {access.loans && access.schedules ? " and " : null}
            {access.schedules ? (
              <Link href="/finance/recurring" className="font-medium text-foreground hover:underline">
                Recurring expenses
              </Link>
            ) : null}
            .
          </>
        }
      />

      <StatGrid className="grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Committed per month" icon={Lock} tone="brand" value={<Money value={s.committedMonthly} />} hint="Instalments and fixed bills, spread to a month" />
        <StatCard
          label="Due in the next 30 days"
          icon={CalendarClock}
          tone={s.due30Amount > 0 ? "warning" : "default"}
          value={<Money value={s.due30Amount} />}
          hint={plural(s.due30Count, "payment", "payments")}
        />
        <StatCard
          label="Overdue"
          icon={AlarmClock}
          tone={s.overdueAmount > 0 ? "danger" : "default"}
          value={<Money value={s.overdueAmount} />}
          hint={s.overdueCount ? `${plural(s.overdueCount, "payment", "payments")} past due` : "Nothing past due"}
        />
      </StatGrid>

      {data.loans ? (
        <Section
          title="Loan and borrowing instalments"
          description="From each loan's terms and the repayments recorded. Record a repayment on the loan: the interest part is saved as an expense."
          contentClassName="p-0 sm:p-0"
        >
          <FixedLoansTable rows={data.loans} />
        </Section>
      ) : null}

      {data.schedules ? (
        <Section
          title="Fixed recurring payments"
          description={
            <>
              Recurring schedules with Fixed commitment switched on. Rent counts as fixed unless its schedule says otherwise.
              {data.overduePosted.count ? (
                <>
                  {" "}
                  <Link href="/finance/payments?tab=overdue" className="font-medium text-foreground hover:underline">
                    {plural(data.overduePosted.count, "posted bill is", "posted bills are")} overdue
                  </Link>
                  .
                </>
              ) : null}
              {seesSalaries ? "" : " Salary schedules are not listed: your role does not include individual salaries."}
            </>
          }
          contentClassName="p-0 sm:p-0"
        >
          <FixedSchedulesTable rows={data.schedules} />
        </Section>
      ) : null}
    </Page>
  );
}
