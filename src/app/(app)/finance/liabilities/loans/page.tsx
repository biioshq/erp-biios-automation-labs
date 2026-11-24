import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, HandCoins, Percent, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { formatNumber } from "@/lib/format";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { getBankAccountOptions } from "@/server/lookups";
import { accruedCategoryOptions, listLoans, loadLiabilityGroups } from "@/features/finance/liabilities/queries";
import { LOAN_FILTER_KEYS, LOAN_SORT_KEYS } from "@/features/finance/liabilities/schemas";
import { LoansView } from "@/features/finance/liabilities/components/loans-view";

export const metadata: Metadata = { title: "Loans & borrowings" };

export default async function LoansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!can(user, "finance.liabilities:view")) return <NoAccess title="Loans & borrowings" />;
  const params = parseListParams(await searchParams, { filterKeys: LOAN_FILTER_KEYS, sortable: LOAN_SORT_KEYS, defaultSort: { id: "date", desc: true } });
  const [data, groups, accounts, categories] = await Promise.all([listLoans(params), loadLiabilityGroups(), getBankAccountOptions(), accruedCategoryOptions()]);
  const s = data.summary;
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);

  return (
    <Page>
      <PageHeader
        eyebrow="Liabilities"
        title="Loans & borrowings"
        description={
          <>
            Bank loans, business loans and other borrowings with their repayments. Principal repaid reduces a loan; interest is saved as an expense, so it shows in{" "}
            <Link href="/finance/expenses?category=interest" className="font-medium text-brand-ink hover:underline">
              Expenses
            </Link>{" "}
            and the profit and loss as a finance cost.
          </>
        }
        actions={
          can(user, "finance.liabilities:create") ? (
            <Button asChild>
              <Link href="?new=1" scroll={false}>
                <Plus /> Add loan
              </Link>
            </Button>
          ) : undefined
        }
      />
      <StatGrid>
        <StatCard
          label={filtered ? "Principal outstanding (filtered)" : "Principal outstanding"}
          value={<Money value={s.outstanding} />}
          icon={Wallet}
          tone="brand"
          hint={`${formatNumber(s.count)} ${s.count === 1 ? "loan" : "loans"}${s.overdueCount ? `, ${s.overdueCount} overdue` : ""}`}
        />
        <StatCard label="Loan amount taken" value={<Money value={s.originalAmount} />} icon={Banknote} hint="Original principal" />
        <StatCard label="Principal repaid" value={<Money value={s.principalPaid} />} icon={HandCoins} hint="Reduces the loans, not an expense" />
        <StatCard
          label="Interest paid"
          value={<Money value={s.interestPaid} />}
          icon={Percent}
          hint={
            s.scheduledLoans ? (
              <>
                Planned still to pay: <Money value={s.plannedInterest} />
              </>
            ) : (
              "Booked as interest expenses"
            )
          }
        />
      </StatGrid>
      <LoansView data={data} groups={groups} accounts={accounts} lenders={data.lenders} groupFilter={data.groupFilter} categories={categories} />
    </Page>
  );
}
