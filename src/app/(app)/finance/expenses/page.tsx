import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { parseListParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { getProjectOptions, getVendorNames } from "@/server/lookups";
import { listExpenses } from "@/features/finance/expenses/queries";
import { EXPENSE_FILTER_KEYS, EXPENSE_SORT_KEYS } from "@/features/finance/expenses/schemas";
import { ExpensesView } from "@/features/finance/expenses/components/expenses-view";
import { ExpenseCategoriesButton } from "@/features/finance/expenses/components/categories-dialog";
import { getExpenseCategories } from "@/server/expense-categories";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/finance/expenses">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  const params = parseListParams(await searchParams, {
    filterKeys: EXPENSE_FILTER_KEYS,
    sortable: EXPENSE_SORT_KEYS,
    defaultSort: { id: "date", desc: true },
  });
  const [data, projects, vendors, categories] = await Promise.all([listExpenses(params), getProjectOptions(), getVendorNames(), getExpenseCategories()]);

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Expenses"
        description={
          <>
            <span className="tabular">{formatNumber(data.summary.count)}</span> expenses ·{" "}
            <Money value={data.summary.total} className="font-medium text-foreground" /> total ·{" "}
            <Money value={data.summary.tax} /> GST{params.q || Object.keys(params.filters).length || params.from ? " (filtered)" : ""}
          </>
        }
        actions={
          <>
            {/* Managing categories is a settings change, so admins only (the actions refuse anyone else too). */}
            {user.role === "admin" ? <ExpenseCategoriesButton categories={categories} /> : null}
            <Button asChild>
              <Link href="?new=1" scroll={false}>
                <Plus /> Add expense
              </Link>
            </Button>
          </>
        }
      />
      {/* Members' totals and rows leave out salaries; without this the gap to the dashboard has no reason. */}
      <SalariesHiddenNote className="-mt-2" />
      <ExpensesView data={data} projects={projects} vendors={vendors} categories={categories} />
    </Page>
  );
}
