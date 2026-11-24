import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, FileText, HandCoins, Info, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { getReceivables } from "@/features/finance/assets/receivables/queries";
import { ReceivablesTable } from "@/features/finance/assets/receivables/components/receivables-table";
import { OverpaidInvoices } from "@/features/finance/assets/receivables/components/overpaid-invoices";

export const metadata: Metadata = { title: "Receivables" };

export default async function ReceivablesPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.receivables:view")) return <NoAccess title="Accounts receivable" eyebrow="Finance · Assets" />;
  const data = await getReceivables();
  const asOf = formatDate(fromDateInput(data.asOf));
  const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Accounts receivable"
        description={<>What customers still owe on issued invoices on {asOf}. Payments count once the income record is linked to its invoice.</>}
        actions={
          <>
            {can(user, "finance.invoices:view") ? (
              <Button variant="outline" asChild>
                <Link href="/finance/invoices">
                  <FileText /> All invoices
                </Link>
              </Button>
            ) : null}
            {can(user, "finance.invoices:create") ? (
              <Button asChild>
                <Link href="/finance/invoices?new=1">
                  <Plus /> New invoice
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <StatCard label="Outstanding receivables" value={<Money value={data.total} />} icon={HandCoins} tone="brand" hint={plural(data.count, "open invoice", "open invoices")} />
        <StatCard label="Overdue" value={<Money value={data.overdue} />} icon={AlarmClock} tone="danger" hint={plural(data.overdueCount, "invoice past its due date", "invoices past their due date")} />
        <StatCard label="Due in the next 30 days" value={<Money value={data.dueSoon} />} icon={CalendarClock} tone="warning" hint="Not overdue yet" />
        <StatCard
          label="Received on invoices"
          value={<Money value={data.receivedAll} tone="positive" />}
          icon={Users}
          tone="success"
          hint={
            <>
              of <Money value={data.invoicedAll} /> invoiced · {plural(data.settledCount, "invoice settled", "invoices settled")}
            </>
          }
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <Section title="Open invoices" description="Overdue first, then by due date. Open one to see its payments or record a receipt." className="xl:col-span-2" contentClassName="p-3 sm:p-4">
          <ReceivablesTable rows={data.rows} />
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="By customer" description="Outstanding per customer, largest first" contentClassName="px-4 py-2 sm:px-5">
            {data.byClient.length ? (
              <ul className="divide-y">
                {data.byClient.map((c) => (
                  <li key={c.client} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.client}</p>
                      <p className="text-xs text-muted-foreground">
                        {plural(c.invoices, "invoice", "invoices")}
                        {c.overdue > 0 ? (
                          <span className="text-danger">
                            {" "}
                            · <Money value={c.overdue} /> overdue
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Money value={c.outstanding} className="shrink-0 font-semibold" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={Users} title="No customer owes anything" description="Customers with unpaid invoices are listed here." />
            )}
          </Section>

          <Section title="Customer advances held" contentClassName="space-y-2 text-sm">
            <Money value={data.customerAdvances} className="text-xl font-semibold" />
            <p className="text-xs text-muted-foreground">
              Money received before it was earned: advances not yet linked to an invoice or whose project is not completed, and anything received above
              an invoice&apos;s total. The books carry it as a
              liability (Customer advances), not as a receivable, so it is not taken off the amounts above.
            </p>
            <OverpaidInvoices rows={data.overpaid} />
          </Section>

          {/* A balance sheet figure: it needs the financial position permission (members see the invoice figures only). */}
          {can(user, "data.financial_position") && Math.abs(data.sheetReceivables - data.total) >= 0.01 ? (
            <Section title="On the balance sheet" contentClassName="space-y-2 text-sm">
              <Money value={data.sheetReceivables} className="text-xl font-semibold" />
              <p className="flex gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  The balance sheet counts invoices and receipts dated up to today only. Invoices or receipts dated later make it differ from the
                  outstanding total above.
                </span>
              </p>
            </Section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
