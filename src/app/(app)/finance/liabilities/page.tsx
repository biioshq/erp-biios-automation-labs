import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, Banknote, CalendarClock, Landmark, Plus, Scale, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { NoAccess } from "@/components/shared/no-access";
import { formatDate, formatNumber } from "@/lib/format";
import { can, requireUser } from "@/server/auth/session";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import { liabilitiesDashboard } from "@/features/finance/liabilities/queries";
import { subgroupParents } from "@/features/finance/liabilities/groups";
import { BreakdownList, DueList } from "@/features/finance/liabilities/components/overview-parts";

export const metadata: Metadata = { title: "Liabilities" };

export default async function LiabilitiesOverviewPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.liabilities:view")) return <NoAccess title="Liabilities" />;
  const data = await liabilitiesDashboard();
  const canCreate = can(user, "finance.liabilities:create");
  const nothing = data.total === 0 && !data.overdueItems.length && !data.upcomingItems.length && !data.openLoans && !data.payablesCount;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Liabilities"
        description="What the company owes: supplier bills, loans, taxes and other obligations. The totals are the balance sheet's, as of today."
        actions={
          <>
            {can(user, "finance.statements:view") ? (
              <Button asChild variant="outline">
                <Link href="/finance/reports/balance-sheet">
                  <Scale /> Balance sheet
                </Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild>
                <Link href="/finance/liabilities/loans?new=1">
                  <Plus /> Add loan
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {nothing ? (
        <EmptyState
          icon={Scale}
          title="Nothing owed on record"
          description="Liabilities appear here from unpaid expenses (accounts payable), loans you add, customer advances and GST on invoices. Add a loan or record an expense On credit to start."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {canCreate ? (
                <Button asChild>
                  <Link href="/finance/liabilities/loans?new=1">
                    <Plus /> Add loan
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/finance/liabilities/current">Current liabilities</Link>
              </Button>
            </div>
          }
        />
      ) : null}

      <StatGrid className="xl:grid-cols-5">
        <StatCard label="Total liabilities" value={<Money value={data.total} />} icon={Scale} tone="brand" hint="Current and non-current" />
        <StatCard label="Current liabilities" value={<Money value={data.current} />} icon={TrendingDown} hint="Due within a year" />
        <StatCard label="Non-current liabilities" value={<Money value={data.nonCurrent} />} icon={Landmark} hint="Due after a year" />
        <StatCard
          label="Overdue payments"
          value={<Money value={data.overdue} />}
          icon={AlarmClock}
          tone={data.overdue > 0 ? "danger" : "default"}
          hint={`${formatNumber(data.overdueCount)} ${data.overdueCount === 1 ? "item" : "items"} past the due date`}
        />
        <StatCard label="Due in the next 30 days" value={<Money value={data.upcoming} />} icon={CalendarClock} tone="warning" hint={`${formatNumber(data.upcomingItems.length)} ${data.upcomingItems.length === 1 ? "item" : "items"}, not overdue yet`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Section
          title="Current liabilities"
          description="Owed within a year, as on the balance sheet"
          actions={
            <>
              <AddSubgroupButton parents={subgroupParents(data.groups, "current_liabilities")} defaultParent="current_liabilities" label="Add new subgroup" variant="ghost" />
              <Link href="/finance/liabilities/current" className="text-xs font-medium text-brand-ink hover:underline">
                Open
              </Link>
            </>
          }
        >
          <BreakdownList lines={data.currentLines} side="current_liabilities" total={data.current} />
        </Section>
        <Section
          title="Non-current liabilities"
          description="Owed after more than a year, as on the balance sheet"
          actions={
            <>
              <AddSubgroupButton parents={subgroupParents(data.groups, "non_current_liabilities")} defaultParent="non_current_liabilities" label="Add new subgroup" variant="ghost" />
              <Link href="/finance/liabilities/non-current" className="text-xs font-medium text-brand-ink hover:underline">
                Open
              </Link>
            </>
          }
        >
          <BreakdownList lines={data.nonCurrentLines} side="non_current_liabilities" total={data.nonCurrent} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Section title="Overdue" description="Loans, other amounts owed and supplier bills past their due date" contentClassName="px-3 py-1">
          <DueList items={data.overdueItems} empty={{ title: "Nothing overdue", description: "Nothing owed is past its due date." }} />
        </Section>
        <Section title="Due in the next 30 days" description="Loans, other amounts owed and supplier bills falling due" contentClassName="px-3 py-1">
          <DueList items={data.upcomingItems} empty={{ title: "Nothing due in the next 30 days", description: "Anything owed with a due date in the next 30 days shows here." }} />
        </Section>
      </div>

      <Section
        title="Planned loan instalments, next 30 days"
        description="From the EMI schedules of loans with a rate, tenure and instalment. A plan, not an amount on record."
        contentClassName="px-3 py-1"
        actions={
          <Link href="/finance/liabilities/loans" className="text-xs font-medium text-brand-ink hover:underline">
            All loans
          </Link>
        }
      >
        {data.instalments.length ? (
          <ul className="divide-y">
            {data.instalments.map((i) => (
              <li key={`${i.id}:${i.date}`}>
                <Link href={`/finance/liabilities/loans?view=${i.id}`} className="flex items-start justify-between gap-3 px-1 py-2.5 hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className={i.late ? "truncate text-xs text-danger" : "truncate text-xs text-muted-foreground"}>
                      {i.code} · {i.lender} · {formatDate(i.date)}
                      {i.late ? ", date passed and not covered by repayments" : ""}
                    </p>
                  </div>
                  <Money value={i.amount} className="shrink-0 text-sm font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={Banknote}
            title="No planned instalments in the next 30 days"
            description="Loans show planned EMIs once their interest rate, tenure and monthly instalment are recorded."
          />
        )}
      </Section>
    </Page>
  );
}
