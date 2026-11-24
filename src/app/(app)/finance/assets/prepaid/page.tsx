import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, Hourglass, Info, ListChecks, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { getPrepaid } from "@/features/finance/assets/prepaid/queries";
import { PrepaidTable } from "@/features/finance/assets/prepaid/components/prepaid-table";

export const metadata: Metadata = { title: "Prepaid expenses" };

export default async function PrepaidExpensesPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const data = await getPrepaid();
  const asOf = formatDate(fromDateInput(data.asOf));

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Prepaid expenses"
        description={<>Expenses paid for a period ahead, with the part not used yet on {asOf}. The cost is spread evenly over each day the payment covers.</>}
        actions={
          <Button variant="outline" asChild>
            <Link href="/finance/expenses">
              <Receipt /> All expenses
            </Link>
          </Button>
        }
      />

      <StatGrid>
        <StatCard label="Remaining prepaid balance" value={<Money value={data.totalRemaining} />} icon={Wallet} tone="brand" hint={`On ${asOf}`} />
        <StatCard label="Used so far" value={<Money value={data.totalUsed} />} icon={Hourglass} tone="info" hint="Charged to expenses up to today" />
        <StatCard label="Prepaid in total" value={<Money value={data.totalPrepaid} />} icon={CalendarRange} hint="Less GST input credit" />
        <StatCard label="Still running" value={formatNumber(data.activeCount)} icon={ListChecks} tone="success" hint={`of ${formatNumber(data.rows.length)} prepaid expenses`} />
      </StatGrid>

      <Section title="Prepaid expenses" description="Holding a balance first, ending soonest first. Open one to see or edit the expense." contentClassName="p-3 sm:p-4">
        <PrepaidTable rows={data.rows} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Marking an expense as prepaid" contentClassName="space-y-2 text-sm text-muted-foreground">
          <p>
            Open the expense on the{" "}
            <Link href="/finance/expenses" className="font-medium text-brand-ink hover:underline">
              Expenses
            </Link>{" "}
            page, choose Edit, mark it as paid in advance and enter the first and last day it covers. A yearly insurance premium paid on 1 April covers
            1 April to 31 March.
          </p>
          <p>It then shows here, and the books move it from Prepaid expenses into its expense category a day at a time.</p>
        </Section>
        <Section title="How the figures are worked out" contentClassName="space-y-2 text-sm text-muted-foreground">
          <p className="flex gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-info" />
            <span>
              Used so far is the prepaid value times the days passed, divided by the days covered. GST paid on the bill is input credit, so it is not
              part of the prepaid value. The remaining total is the Prepaid expenses line on the balance sheet.
            </span>
          </p>
          <p>Stock purchases and payments for fixed assets are carried as inventory and fixed assets instead, even when marked as prepaid.</p>
        </Section>
      </div>
    </Page>
  );
}
