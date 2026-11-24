import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, BadgeIndianRupee, CalendarDays, ChartColumn, FileText, ReceiptIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { incomeSummary, summaryRange } from "@/features/finance/income/summary";
import { SummaryRange } from "@/features/finance/income/components/summary-range";
import { SummaryChart } from "@/features/finance/income/components/summary-chart";
import { CategoryTable, DailyTable, OpenInvoicesTable, PartyTable, YearTable } from "@/features/finance/income/components/summary-tables";

export const metadata: Metadata = { title: "Income summary" };

const dateParam = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export default async function IncomeSummaryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.income:view")) return <NoAccess title="Income summary" />;
  const sp = await searchParams;
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const range = summaryRange(from, to);
  const data = await incomeSummary(range);
  const rangeText = `${formatDate(fromDateInput(range.from))} to ${formatDate(fromDateInput(range.to))}`;
  const hasChart = data.months.some((m) => m.received > 0 || m.invoiced > 0);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Income summary"
        description="Cash received comes from income records. Invoiced comes from customer invoices, with GST. A payment linked to an invoice settles it, so the two are never added together."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/finance/income">
                <BadgeIndianRupee /> Income records
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/finance/invoices">
                <FileText /> Invoices
              </Link>
            </Button>
          </>
        }
      />

      <SummaryRange from={range.from} to={range.to} isDefault={!from && !to} />

      <StatGrid>
        <StatCard
          label="Cash received"
          value={<Money value={data.received} />}
          icon={BadgeIndianRupee}
          tone="success"
          hint={
            <>
              {formatNumber(data.receiptCount)} {data.receiptCount === 1 ? "receipt" : "receipts"}
              {data.receivedAgainstInvoices > 0 ? (
                <>
                  , <Money value={data.receivedAgainstInvoices} /> of it against invoices
                </>
              ) : null}
              {data.onCredit.count > 0 ? (
                <>
                  . {formatNumber(data.onCredit.count)} {data.onCredit.count === 1 ? "record" : "records"} saved on credit (
                  <Money value={data.onCredit.total} />) not counted: not money received
                </>
              ) : null}
            </>
          }
        />
        <StatCard
          label="Invoiced (with GST)"
          value={<Money value={data.invoiced} />}
          icon={FileText}
          tone="info"
          hint={
            <>
              {formatNumber(data.invoiceCount)} {data.invoiceCount === 1 ? "invoice" : "invoices"}, <Money value={data.invoicedTaxable} /> before GST
            </>
          }
        />
        <StatCard
          label="Outstanding receivables"
          value={<Money value={data.outstanding} />}
          icon={ReceiptIndianRupee}
          tone="brand"
          hint={`${formatNumber(data.openCount)} open ${data.openCount === 1 ? "invoice" : "invoices"}, as of today`}
        />
        <StatCard
          label="Overdue receivables"
          value={<Money value={data.overdue} />}
          icon={AlarmClock}
          tone={data.overdue > 0 ? "danger" : "default"}
          hint={
            data.overdue > 0 ? (
              <Link href="/finance/invoices?status=overdue" className="underline underline-offset-2">
                See overdue invoices
              </Link>
            ) : (
              "Nothing past its due date"
            )
          }
        />
      </StatGrid>

      <Section title="Month by month" description={`Cash received and invoiced each month, ${rangeText}.`}>
        {hasChart ? (
          <SummaryChart data={data.months} />
        ) : (
          <EmptyState icon={ChartColumn} compact title="Nothing received or invoiced in this range" description="Pick a wider date range, or record income and invoices first." />
        )}
      </Section>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Section title="Daily income" description="Cash received on each day, from income records." contentClassName="p-0 sm:p-0">
          {data.days.length ? (
            <DailyTable rows={data.days} from={range.from} to={range.to} />
          ) : (
            <EmptyState icon={CalendarDays} compact className="m-4" title="No receipts in this range" />
          )}
        </Section>
        <Section title="By financial year" description="April to March, over all records. Not limited by the date range." contentClassName="p-0 sm:p-0">
          {data.years.length ? (
            <YearTable rows={data.years} />
          ) : (
            <EmptyState icon={CalendarDays} compact className="m-4" title="No income or invoices recorded yet" />
          )}
        </Section>
      </div>

      <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
        <Section title="By category" description={`Cash received by income category, ${rangeText}.`} contentClassName="p-0 sm:p-0">
          {data.categories.length ? (
            <CategoryTable rows={data.categories} from={range.from} to={range.to} />
          ) : (
            <EmptyState icon={BadgeIndianRupee} compact className="m-4" title="No receipts in this range" />
          )}
        </Section>
        <Section
          title="Outstanding receivables"
          description="Open invoices due first, as of today."
          contentClassName="p-0 sm:p-0"
          actions={
            data.openCount > 0 ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/finance/invoices?status=unpaid,partial,overdue">All open invoices</Link>
              </Button>
            ) : null
          }
        >
          {data.openInvoices.length ? (
            <OpenInvoicesTable rows={data.openInvoices} />
          ) : (
            <EmptyState icon={ReceiptIndianRupee} compact className="m-4" title="No open invoices" description="Every issued invoice is fully received." />
          )}
        </Section>
      </div>

      <Section
        title="Project-wise income"
        description={`Cash received and invoiced per project, ${rangeText}. Outstanding is what is still owed today.`}
        contentClassName="p-0 sm:p-0"
      >
        {data.projects.length ? (
          <PartyTable rows={data.projects} label="Project" />
        ) : (
          <EmptyState icon={ChartColumn} compact className="m-4" title="No project income in this range" />
        )}
      </Section>

      <Section
        title="Customer-wise income"
        description={`Cash received and invoiced per customer, ${rangeText}. Names are matched regardless of case.`}
        contentClassName="p-0 sm:p-0"
      >
        {data.customers.length ? (
          <PartyTable rows={data.customers} label="Customer" />
        ) : (
          <EmptyState icon={ChartColumn} compact className="m-4" title="No customer income in this range" />
        )}
      </Section>
    </Page>
  );
}
