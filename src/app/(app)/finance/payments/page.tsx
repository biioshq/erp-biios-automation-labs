import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, HandCoins, History } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber } from "@/lib/format";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { getBankAccountOptions } from "@/server/lookups";
import { getPaymentDefaults, getPaymentTracking } from "@/features/finance/expenses/payment-queries";
import { parsePaymentTab } from "@/features/finance/expenses/payment-tabs";
import { PaymentExpensesTable, PaymentHistoryTable, PaymentTabs } from "@/features/finance/expenses/components/payments-view";

export const metadata: Metadata = { title: "Outstanding payments" };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.payments:view")) return <NoAccess title="Outstanding payments" />;
  const sp = await searchParams;
  const tab = parsePaymentTab(sp.tab);
  const params = parseListParams(sp, { sortable: ["date", "amount", "outstanding", "due", "vendor"] });
  const [data, accounts, defaults] = await Promise.all([getPaymentTracking(tab, params), getBankAccountOptions(), getPaymentDefaults()]);
  const t = data.totals;
  const owed = t.outstanding.total;
  const owedCount = t.outstanding.count;
  const filtered = Boolean(params.q || params.from || params.to);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Outstanding payments"
        description={
          <>
            Bills still to pay, as of today.{filtered ? " Filtered by the search and dates below." : ""} Tick Mark as paid when you pay one: the
            expense keeps its date and shows as paid in{" "}
            <Link href="/finance/expenses" className="font-medium text-foreground hover:underline">
              Total expenses
            </Link>
            . A bill saved as Not paid yet or Partly paid shows here by itself.
          </>
        }
      />
      <SalariesHiddenNote className="-mt-2" />

      <StatGrid>
        <StatCard
          label="Still owed"
          icon={HandCoins}
          tone={owed > 0 ? "warning" : "default"}
          value={<Money value={owed} />}
          hint={plural(owedCount, "bill", "bills")}
        />
        <StatCard
          label="Overdue"
          icon={AlarmClock}
          tone={t.overdue.total > 0 ? "danger" : "default"}
          value={<Money value={t.overdue.total} />}
          hint={plural(t.overdue.count, "bill past its due date", "bills past their due date")}
        />
        <StatCard
          label="Due in the next 30 days"
          icon={CalendarClock}
          tone="info"
          value={<Money value={t.upcoming.total} />}
          hint={plural(t.upcoming.count, "bill", "bills")}
        />
        <StatCard
          label="Payments recorded"
          icon={History}
          value={<Money value={t.history.total} />}
          hint={`${plural(t.history.count, "payment", "payments")} recorded one by one`}
        />
      </StatGrid>

      <PaymentTabs tab={tab} totals={t} />

      {tab === "history" ? (
        <PaymentHistoryTable rows={data.history} total={data.total} page={data.page} pageSize={data.pageSize} />
      ) : (
        <PaymentExpensesTable
          // A new tab or page starts with nothing selected and no rows hidden.
          key={`${tab}:${data.page}`}
          tab={tab}
          rows={data.rows}
          total={data.total}
          page={data.page}
          pageSize={data.pageSize}
          accounts={accounts}
          defaults={defaults}
        />
      )}
    </Page>
  );
}
