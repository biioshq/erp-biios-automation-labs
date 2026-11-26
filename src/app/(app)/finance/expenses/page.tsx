import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckBig, HandCoins, Plus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { getBankAccountOptions, getProjectOptions, getVendorNames } from "@/server/lookups";
import { listExpenses } from "@/features/finance/expenses/queries";
import { EXPENSE_FILTER_KEYS, EXPENSE_SORT_KEYS } from "@/features/finance/expenses/schemas";
import { ExpensesView } from "@/features/finance/expenses/components/expenses-view";
import { ExpenseCategoriesButton } from "@/features/finance/expenses/components/categories-dialog";
import { ImportStatementCard } from "@/features/finance/expenses/components/import-statement-card";
import { getExpenseCategories } from "@/server/expense-categories";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Total expenses" };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export default async function ExpensesPage({ searchParams }: PageProps<"/finance/expenses">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.expenses:view")) return <NoAccess title="Total expenses" />;
  const params = parseListParams(await searchParams, {
    filterKeys: EXPENSE_FILTER_KEYS,
    sortable: EXPENSE_SORT_KEYS,
    defaultSort: { id: "date", desc: true },
  });
  const [data, projects, vendors, categories, accounts] = await Promise.all([
    listExpenses(params),
    getProjectOptions(),
    getVendorNames(),
    getExpenseCategories(),
    getBankAccountOptions(),
  ]);
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);
  const s = data.summary;
  const outstandingCount = s.outstandingCount ?? 0;

  return (
    <Page>
      {can(user, "finance.bank_statements:create") ? <ImportStatementCard /> : null}
      <PageHeader
        eyebrow="Finance"
        title="Total expenses"
        description={
          <>
            Every expense the company has incurred, paid and outstanding. <span className="tabular">{formatNumber(s.count)}</span> expenses ·{" "}
            <Money value={s.tax} /> GST{filtered ? " (filtered)" : ""}
          </>
        }
        actions={
          <>
            {/* Managing categories has its own permission (the actions refuse anyone else too). */}
            {can(user, "finance.expense_categories:view") ? <ExpenseCategoriesButton categories={categories} /> : null}
            {can(user, "finance.expenses:create") ? (
              <Button asChild>
                <Link href="?new=1" scroll={false}>
                  <Plus /> Add expense
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {/* Members' totals and rows leave out salaries; without this the gap to the dashboard has no reason. */}
      <SalariesHiddenNote className="-mt-2" />

      <StatGrid className="grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          label={filtered ? "Incurred (filtered)" : "Total incurred"}
          icon={Receipt}
          tone="brand"
          value={<Money value={s.total} />}
          hint="Paid and outstanding together, each counted once"
        />
        <StatCard
          label="Paid"
          icon={CircleCheckBig}
          tone="success"
          value={<Money value={s.paid ?? 0} />}
          hint={(s.fromStock ?? 0) > 0 ? <>Paid in full or in part so far, plus <Money value={s.fromStock ?? 0} /> used from stock</> : "Paid in full or in part so far"}
        />
        <StatCard
          label="Outstanding"
          icon={HandCoins}
          tone={(s.outstanding ?? 0) > 0 ? "warning" : "default"}
          value={<Money value={s.outstanding ?? 0} />}
          hint={
            can(user, "finance.payments:view") && outstandingCount > 0 ? (
              <Link href="/finance/payments" className="hover:underline">
                {plural(outstandingCount, "bill", "bills")} still to pay
              </Link>
            ) : (
              `${plural(outstandingCount, "bill", "bills")} still to pay`
            )
          }
        />
      </StatGrid>

      <ExpensesView data={data} projects={projects} vendors={vendors} categories={categories} accounts={accounts} />
    </Page>
  );
}
