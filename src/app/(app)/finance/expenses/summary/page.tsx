import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarDays, ChartColumn, FolderKanban, HandCoins, Layers, Receipt, Store, Tags, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { financialYearIST, fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, round2 } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { expenseSummaryRange, getExpenseSummary } from "@/features/finance/expenses/summary-queries";
import { ExpenseSummaryRange } from "@/features/finance/expenses/components/summary-range";
import { DailyExpenseChart, MonthlyExpenseChart } from "@/features/finance/expenses/components/summary-charts";
import { NatureSplitList, PaymentSplitList, SliceTable, YearTable, listHref } from "@/features/finance/expenses/components/summary-tables";

export const metadata: Metadata = { title: "Expense summary" };

const dateParam = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default async function ExpenseSummaryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.expenses:view")) return <NoAccess title="Expense summary" />;
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const range = expenseSummaryRange(from, to);
  const data = await getExpenseSummary(range);
  const rangeText = `${formatDate(fromDateInput(range.from))} to ${formatDate(fromDateInput(range.to))}`;
  const t = data.totals;
  const p = data.payments;
  const owed = round2(p.unpaid + p.partial + p.overdue);
  const empty = t.count === 0;
  const dailyHasData = data.daily.some((d) => d.total > 0);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Expense summary"
        description="Expenses recorded in the date range, by the expense date: the same rows the Expenses list adds up for these dates. Stock used from inventory is counted once, when it was bought."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={listHref(range)}>
                <Receipt /> Expense records
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/finance/payments">
                <CalendarClock /> Payment tracking
              </Link>
            </Button>
          </>
        }
      />
      <SalariesHiddenNote className="-mt-2" />

      <ExpenseSummaryRange from={range.from} to={range.to} isDefault={!from && !to} />

      <StatGrid>
        <StatCard
          label="Expenses recorded"
          icon={Receipt}
          tone="brand"
          value={<Money value={t.total} />}
          hint={
            <>
              {plural(t.count, "expense", "expenses")}, <Money value={t.tax} /> of it GST
            </>
          }
        />
        <StatCard label="Paid so far" icon={Wallet} tone="success" value={<Money value={p.paid} />} hint="On these expenses, as of today" />
        <StatCard
          label="Still owed"
          icon={HandCoins}
          tone={p.overdue > 0 ? "danger" : owed > 0 ? "warning" : "default"}
          value={<Money value={owed} />}
          hint={
            p.overdue > 0 ? (
              <Link href="/finance/payments?tab=overdue" className="underline underline-offset-2">
                <Money value={p.overdue} /> overdue
              </Link>
            ) : (
              plural(p.openCount, "open bill", "open bills")
            )
          }
        />
        <StatCard
          label="Direct costs"
          icon={Layers}
          tone="info"
          value={<Money value={data.nature.direct} />}
          hint={
            <>
              <Money value={data.nature.indirect} /> indirect (overhead)
            </>
          }
        />
      </StatGrid>

      <Section
        title="Month by month"
        description={`Expenses recorded each month, direct and indirect, ${rangeText}.${data.monthlyTrimmed ? " Only the latest 36 months are shown." : ""}`}
      >
        {empty ? (
          <EmptyState icon={ChartColumn} compact title="No expenses recorded in this range" description="Pick a wider date range, or add expenses first." />
        ) : (
          <MonthlyExpenseChart data={data.monthly} />
        )}
      </Section>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Section title="Daily expenses" description={`Each day of the last ${data.daily.length === 1 ? "day" : `${data.daily.length} days`} of the range, up to today.`}>
          {dailyHasData ? (
            <DailyExpenseChart data={data.daily} />
          ) : (
            <EmptyState icon={CalendarDays} compact title="No expenses on these days" description="The chart covers up to 31 days, ending on the last day of the range or today." />
          )}
        </Section>
        <Section title="By financial year" description="April to March, over all records. Not limited by the date range." contentClassName="p-0 sm:p-0">
          {data.yearly.length ? (
            <YearTable rows={data.yearly} current={financialYearIST().label} />
          ) : (
            <EmptyState icon={CalendarDays} compact className="m-4" title="No expenses recorded yet" />
          )}
        </Section>
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Section
          title="Paid and still owed"
          description="What is paid and what is owed on the expenses of this range, as of today."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/finance/payments">Open payment tracking</Link>
            </Button>
          }
        >
          {empty ? <EmptyState icon={HandCoins} compact title="No expenses recorded in this range" /> : <PaymentSplitList split={p} total={t.total} />}
        </Section>
        <Section
          title="Direct and indirect"
          description="Direct: on a project, or in a category set as direct. Indirect: company overheads. Admins set each category under Expenses, Categories."
        >
          {empty ? <EmptyState icon={Layers} compact title="No expenses recorded in this range" /> : <NatureSplitList nature={data.nature} total={t.total} range={range} />}
        </Section>
      </div>

      <Section title="Category-wise" description={`Expenses recorded per category, ${rangeText}.`} contentClassName="p-0 sm:p-0">
        {data.byCategory.length ? (
          <SliceTable rows={data.byCategory} label="Category" total={t.total} hrefOf={(r) => listHref(range, { category: r.key })} />
        ) : (
          <EmptyState icon={Tags} compact className="m-4" title="No expenses recorded in this range" />
        )}
      </Section>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Section title="Project-wise" description={`Expenses recorded per project, ${rangeText}. Company overhead is everything not on a project.`} contentClassName="p-0 sm:p-0">
          {data.byProject.length ? (
            <SliceTable
              rows={data.byProject}
              label="Project"
              total={t.total}
              hrefOf={(r) => (r.key.startsWith("deleted:") ? null : listHref(range, { project: r.key }))}
              footnote="Stock used on a project that was expensed when it was bought is left out here (it is in the purchase). The project's own page counts it in its spend."
            />
          ) : (
            <EmptyState icon={FolderKanban} compact className="m-4" title="No expenses recorded in this range" />
          )}
        </Section>
        <Section
          title="Vendor-wise"
          description={`The ${data.byVendor.length < data.vendorCount ? `${data.byVendor.length} largest of ${formatNumber(data.vendorCount)} vendors` : "vendors"} by amount, ${rangeText}.`}
          contentClassName="p-0 sm:p-0"
        >
          {data.byVendor.length ? (
            <SliceTable rows={data.byVendor} label="Vendor or payee" total={t.total} hrefOf={(r) => listHref(range, { vendor: r.key })} />
          ) : (
            <EmptyState icon={Store} compact className="m-4" title="No expenses recorded in this range" />
          )}
        </Section>
      </div>
    </Page>
  );
}
