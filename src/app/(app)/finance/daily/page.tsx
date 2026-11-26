import type { Metadata } from "next";
import { CalendarDays, CircleDollarSign, HandCoins, Receipt, Store, TrendingUp, Users, Wallet } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { NoAccess } from "@/components/shared/no-access";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { can, requireUser } from "@/server/auth/session";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { getDailyOverview } from "@/features/finance/daily/server";
import { dailyRange, MAX_DAILY_DAYS } from "@/features/finance/daily/types";
import { DailyControls } from "@/features/finance/daily/components/daily-controls";
import { DailyChart } from "@/features/finance/daily/components/daily-chart";
import { CustomerTable, DayTable, TransactionTable, VendorTable } from "@/features/finance/daily/components/daily-tables";
import { DownloadButtons } from "@/features/reports/components/download-buttons";
import { mayExportReport } from "@/features/reports/catalog";
import { metaOf } from "@/features/reports/meta";
import { getFilterOptions } from "@/features/reports/options";

export const metadata: Metadata = { title: "Daily overview" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const dateParam = (v: string | string[] | undefined) => {
  const s = first(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromDateInput(s).getTime()) ? s : null;
};
const listParam = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(",") : (v ?? ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default async function DailyOverviewPage({ searchParams }: PageProps<"/finance/daily">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.daily:view")) return <NoAccess eyebrow="Finance" title="Daily overview" />;

  const sp = await searchParams;
  const today = toDateInput(new Date());
  const from = dateParam(sp.from);
  const to = dateParam(sp.to);
  const day = dateParam(sp.day);
  const mode = from || to ? "range" : "day";
  const range = mode === "range" ? dailyRange(from, to, today) : dailyRange(day, day, today);
  const filters = { project: listParam(sp.project), vendor: listParam(sp.vendor), category: listParam(sp.category) };

  const [data, options] = await Promise.all([
    getDailyOverview({ from: range.from, to: range.to, filters }),
    getFilterOptions(metaOf("daily"), true),
  ]);
  const t = data.totals;
  const single = data.single;
  const when = single ? formatDate(fromDateInput(data.from)) : `${formatDate(fromDateInput(data.from))} to ${formatDate(fromDateInput(data.to))}`;
  const endText = single ? "the end of the day" : `the end of ${formatDate(fromDateInput(data.to))}`;
  const quiet = !t.income && !t.expenses && !t.payments && !t.outstanding && !data.transactionTotal;
  const canDownload = mayExportReport("daily", (p) => can(user, p));

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Daily overview"
        description={`Income, expenses, payments and what is owed, for ${single ? "" : "each day of "}${when}. It updates when records change.`}
        actions={canDownload ? <DownloadButtons type="daily" filters={{ from: data.from, to: data.to, ...data.filters }} refreshOnDownload={false} /> : undefined}
      />

      <DailyControls
        mode={mode}
        day={single ? data.from : today}
        from={data.from}
        to={data.to}
        filters={data.filters}
        options={options}
      />
      <div className="-mt-2 space-y-1">
        {data.filtered ? (
          <p className="text-xs text-muted-foreground">
            Vendor and category narrow expenses, payments and what is owed. Project narrows income as well. Cash flow from the books is for the whole company, so it is shown without filters.
          </p>
        ) : null}
        {data.clamped ? <p className="text-xs text-muted-foreground">A range shows at most {MAX_DAILY_DAYS} days. This one is cut to the last {MAX_DAILY_DAYS}.</p> : null}
        <SalariesHiddenNote />
      </div>

      <StatGrid className="xl:grid-cols-5">
        <StatCard
          label="Income received"
          icon={TrendingUp}
          tone="success"
          value={<Money value={t.income} />}
          hint={
            <>
              {plural(t.incomeCount, "receipt", "receipts")}, by date received
              {t.onCredit.count ? (
                <>
                  . <Money value={t.onCredit.total} /> saved On credit is not counted
                </>
              ) : null}
            </>
          }
        />
        <StatCard
          label="Expenses incurred"
          icon={Receipt}
          tone="brand"
          value={<Money value={t.expenses} />}
          hint={`${plural(t.expenseCount, "expense", "expenses")}, by expense date, paid or not`}
        />
        <StatCard
          label="Payments made"
          icon={Wallet}
          tone="info"
          value={<Money value={t.payments} />}
          hint={`${plural(t.paymentCount, "payment", "payments")}, by payment date, any bill`}
        />
        <StatCard
          label="Owed to vendors"
          icon={HandCoins}
          tone={t.overdue > 0 ? "danger" : t.outstanding > 0 ? "warning" : "default"}
          value={<Money value={t.outstanding} />}
          hint={
            <>
              At {endText}, {plural(t.outstandingCount, "bill", "bills")}
              {t.overdue > 0 ? (
                <>
                  , <Money value={t.overdue} /> overdue
                </>
              ) : null}
            </>
          }
        />
        <StatCard
          label={data.net?.basis === "ledger" ? "Net cash flow" : "Received less paid"}
          icon={CircleDollarSign}
          tone={data.net && data.net.value < 0 ? "danger" : "default"}
          value={data.net ? <Money value={data.net.value} tone="auto" /> : <span className="text-muted-foreground">Not shown</span>}
          hint={
            data.net?.basis === "ledger" ? (
              <>
                In <Money value={data.net.cashIn ?? 0} />, out <Money value={data.net.cashOut ?? 0} />. Bank and cash accounts, own-account transfers left out
                {t.onCredit.count ? ". The books count older On credit income as money in" : null}
              </>
            ) : data.net ? (
              "Income received minus payments made, from the records, not the bank"
            ) : (
              "Income is not narrowed by a vendor or category filter, so a net would mislead"
            )
          }
        />
      </StatGrid>

      {quiet ? (
        <EmptyState icon={CalendarDays} title="Nothing recorded" description="No income, expenses or payments fall on these dates with these filters, and nothing was owed. Pick other dates or clear the filters." />
      ) : (
        <>
          {!single ? (
            <>
              <Section title="Day by day" description="Income received, expenses incurred and payments made on each day.">
                <DailyChart data={data.days} />
              </Section>
              <Section title="Each day" description="What was owed is the balance at the end of that day." contentClassName="p-0 sm:p-0">
                <DayTable days={data.days} net={data.net} total={t} />
              </Section>
            </>
          ) : null}

          <div className="grid gap-5 sm:gap-6 lg:grid-cols-2">
            <Section
              title="Vendor-wise"
              description={`Billed and paid ${single ? "on the day" : "in the range"}, and what is still owed at ${endText}.${data.vendorCount > data.vendors.length ? ` The ${data.vendors.length} largest of ${formatNumber(data.vendorCount)}.` : ""}`}
              contentClassName="p-0 sm:p-0"
            >
              {data.vendors.length ? (
                <VendorTable rows={data.vendors} range={data} />
              ) : (
                <EmptyState icon={Store} compact className="m-4" title="No vendor activity" description="Nothing was billed, paid or owed." />
              )}
            </Section>
            <Section
              title="Customer-wise receipts"
              description={`Income received ${single ? "on the day" : "in the range"}, by the name on the record.${data.customerCount > data.customers.length ? ` The ${data.customers.length} largest of ${formatNumber(data.customerCount)}.` : ""}`}
              contentClassName="p-0 sm:p-0"
            >
              {data.customers.length ? (
                <CustomerTable rows={data.customers} range={data} />
              ) : (
                <EmptyState icon={Users} compact className="m-4" title="No receipts" description="No income was received." />
              )}
            </Section>
          </div>

          <Section
            title="Transactions"
            description={`Expenses billed, payments made, income received${data.seesPosition && !data.filtered ? " and transfers between own accounts" : ""}.${data.transactionTotal > data.transactions.length ? ` The latest ${formatNumber(data.transactions.length)} of ${formatNumber(data.transactionTotal)}; a download has them all.` : ""}`}
            contentClassName="p-0 sm:p-0"
          >
            {data.transactions.length ? (
              <TransactionTable rows={data.transactions} showDay={!single} />
            ) : (
              <EmptyState icon={Receipt} compact className="m-4" title="No transactions" />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
