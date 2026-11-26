import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckBig, HandCoins, Package } from "lucide-react";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { formatNumber } from "@/lib/format";
import { parseListParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { getBankAccountOptions, getVendorNames } from "@/server/lookups";
import { getExpenseCategories } from "@/server/expense-categories";
import { listOneOffPurchases } from "@/features/finance/expenses/fixed-queries";
import { getPaymentDefaults } from "@/features/finance/expenses/payment-queries";
import { EXPENSE_FILTER_KEYS, EXPENSE_SORT_KEYS } from "@/features/finance/expenses/schemas";
import { FixedPurchasesTable } from "@/features/finance/expenses/components/fixed-payments-view";

export const metadata: Metadata = { title: "Fixed payments" };

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * Fixed payments: one-off purchases of goods (materials, equipment, stock and fixed assets), the
 * things not bought every month. Regular costs paid on a cycle are under Recurring expenses.
 */
export default async function FixedPaymentsPage({ searchParams }: PageProps<"/finance/expenses/fixed">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.expenses:view")) return <NoAccess title="Fixed payments" />;
  const params = parseListParams(await searchParams, {
    filterKeys: EXPENSE_FILTER_KEYS,
    sortable: EXPENSE_SORT_KEYS,
    defaultSort: { id: "date", desc: true },
  });
  const [data, vendors, categories, accounts, defaults] = await Promise.all([
    listOneOffPurchases(params),
    getVendorNames(),
    getExpenseCategories(),
    getBankAccountOptions(),
    getPaymentDefaults(),
  ]);
  const s = data.summary;
  const ranged = Boolean(params.from || params.to);
  const filtered = Boolean(params.q || Object.keys(params.filters).length);
  const scope = ranged ? "in the dates picked" : "all dates";

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Fixed payments"
        description={
          <>
            One-off purchases of goods: materials, equipment, stock and fixed assets. Rent, bills and loan EMIs are paid on a cycle, so they are under{" "}
            <Link href="/finance/recurring" className="font-medium text-foreground hover:underline">
              Recurring expenses
            </Link>
            .
          </>
        }
      />
      <SalariesHiddenNote className="-mt-2" />

      <StatGrid className="grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          label={filtered ? "Purchases (filtered)" : "Total purchases"}
          icon={Package}
          tone="brand"
          value={<Money value={s.total} />}
          hint={`${plural(s.count, "purchase", "purchases")}, ${scope}`}
        />
        <StatCard label="Paid" icon={CircleCheckBig} tone="success" value={<Money value={s.paid ?? 0} />} hint="What has been paid on these purchases" />
        <StatCard
          label="Outstanding"
          icon={HandCoins}
          tone={(s.outstanding ?? 0) > 0 ? "warning" : "default"}
          value={<Money value={s.outstanding ?? 0} />}
          hint={(s.outstandingCount ?? 0) > 0 ? `${plural(s.outstandingCount ?? 0, "purchase", "purchases")} still to pay` : "Nothing owed"}
        />
      </StatGrid>

      <FixedPurchasesTable data={data} vendors={vendors} categories={categories} accounts={accounts} defaults={defaults} />
    </Page>
  );
}
