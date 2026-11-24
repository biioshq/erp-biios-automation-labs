import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, Receipt, SplitSquareHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { formatNumber } from "@/lib/format";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { getBankAccountOptions } from "@/server/lookups";
import { payablesPage } from "@/features/finance/liabilities/queries";
import { PAYABLE_FILTER_KEYS, PAYABLE_SORT_KEYS } from "@/features/finance/liabilities/schemas";
import { BillPaymentHistory, PayablesTable, VendorTable } from "@/features/finance/liabilities/components/payables-view";

export const metadata: Metadata = { title: "Accounts payable" };

export default async function PayablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!can(user, "finance.liabilities:view")) return <NoAccess title="Accounts payable" />;
  const params = parseListParams(await searchParams, { filterKeys: PAYABLE_FILTER_KEYS, sortable: PAYABLE_SORT_KEYS, defaultSort: { id: "dueDate", desc: false } });
  const [data, accounts] = await Promise.all([payablesPage(params), getBankAccountOptions()]);
  const s = data.summary;
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);

  return (
    <Page>
      <PageHeader
        eyebrow="Liabilities"
        title="Accounts payable"
        description={
          <>
            What is owed to suppliers and vendors: expenses not paid in full, including older ones saved as On credit.{" "}
            <span className="tabular">{formatNumber(s.count)}</span> {s.count === 1 ? "bill" : "bills"} open
            {filtered ? (
              <>
                {" "}
                (<span className="tabular">{formatNumber(s.filteredCount)}</span> shown, <Money value={s.filteredTotal} className="font-medium text-foreground" />)
              </>
            ) : null}
            .
          </>
        }
        actions={
          can(user, "finance.expenses:create") ? (
            <Button asChild variant="outline">
              <Link href="/finance/expenses?new=1">
                <Receipt /> Add expense
              </Link>
            </Button>
          ) : undefined
        }
      />
      <StatGrid>
        <StatCard label="Total payable" value={<Money value={s.total} />} icon={Receipt} tone="brand" hint={`${formatNumber(s.unpaidCount)} unpaid, ${formatNumber(s.partial)} part paid`} />
        <StatCard
          label="Overdue"
          value={<Money value={s.overdue} />}
          icon={AlarmClock}
          tone={s.overdue > 0 ? "danger" : "default"}
          hint={`${formatNumber(s.overdueCount)} ${s.overdueCount === 1 ? "bill" : "bills"} past due`}
        />
        <StatCard label="Due in the next 30 days" value={<Money value={s.dueSoon} />} icon={CalendarClock} tone="warning" hint="Not overdue yet" />
        <StatCard label="Partly paid bills" value={formatNumber(s.partial)} icon={SplitSquareHorizontal} hint="Some paid, the rest still owed" />
      </StatGrid>

      <Section title="Bills to pay" description="Oldest due first. A bill with no due date is due on its own date." contentClassName="p-3 sm:p-4">
        <PayablesTable data={data} vendors={data.vendors} accounts={accounts} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Section title="By vendor" description="Outstanding per vendor. Pick one to filter the bills above." contentClassName="p-3 sm:p-4">
          <VendorTable rows={data.byVendor} />
        </Section>
        <Section title="Payment history" description="Latest payments recorded against bills" contentClassName="px-3 py-1">
          <BillPaymentHistory rows={data.history} />
        </Section>
      </div>
    </Page>
  );
}
