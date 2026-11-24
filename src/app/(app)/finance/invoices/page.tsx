import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CalendarClock, ChartColumn, HandCoins, Plus, ReceiptIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getBankAccountOptions, getProjectOptions } from "@/server/lookups";
import { requireUser } from "@/server/auth/session";
import { getClientNames } from "@/features/finance/income/queries";
import { getInvoiceClients, invoiceStats, listInvoicePayments, listInvoices } from "@/features/finance/invoices/queries";
import {
  INVOICE_FILTER_KEYS,
  INVOICE_PAYMENT_FILTER_KEYS,
  INVOICE_PAYMENT_SORT_KEYS,
  INVOICE_SORT_KEYS,
} from "@/features/finance/invoices/schemas";
import { InvoicesView } from "@/features/finance/invoices/components/invoices-view";
import { PaymentsView } from "@/features/finance/invoices/components/payments-view";

export const metadata: Metadata = { title: "Invoices & receivables" };

function Tabs({ active }: { active: "invoices" | "payments" }) {
  const tab = (key: "invoices" | "payments", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors",
        active === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Invoice views" className="inline-flex w-fit rounded-lg border bg-muted/50 p-1">
      {tab("invoices", "/finance/invoices", "Invoices")}
      {tab("payments", "/finance/invoices?tab=payments", "Payments received")}
    </nav>
  );
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const payments = sp.tab === "payments";
  const [stats, projects, clients, invoiceClients, accounts] = await Promise.all([
    invoiceStats(),
    getProjectOptions(),
    getClientNames(),
    getInvoiceClients(),
    getBankAccountOptions(),
  ]);

  const header = (description: React.ReactNode) => (
    <PageHeader
      eyebrow="Finance"
      title="Invoices & receivables"
      description={description}
      actions={
        <>
          <Button asChild variant="outline">
            <Link href="/finance/income/summary">
              <ChartColumn /> Income summary
            </Link>
          </Button>
          <Button asChild>
            <Link href="/finance/invoices?new=1" scroll={false}>
              <Plus /> New invoice
            </Link>
          </Button>
        </>
      }
    />
  );

  const cards = (
    <StatGrid>
      <StatCard
        label="Outstanding receivables"
        value={<Money value={stats.outstanding} />}
        icon={ReceiptIndianRupee}
        tone="brand"
        hint={`${formatNumber(stats.openCount)} open ${stats.openCount === 1 ? "invoice" : "invoices"}, as of today`}
      />
      <StatCard
        label="Overdue"
        value={<Money value={stats.overdue} />}
        icon={AlarmClock}
        tone={stats.overdue > 0 ? "danger" : "default"}
        hint={
          stats.overdueCount ? (
            <Link href="/finance/invoices?status=overdue" className="underline underline-offset-2">
              {formatNumber(stats.overdueCount)} past their due date
            </Link>
          ) : (
            "Nothing past its due date"
          )
        }
      />
      <StatCard label="Due in the next 30 days" value={<Money value={stats.dueSoon} />} icon={CalendarClock} tone="warning" hint="Not overdue yet" />
      <StatCard
        label="Advances not applied"
        value={<Money value={stats.advances} />}
        icon={HandCoins}
        tone="info"
        hint={
          stats.advanceCount ? (
            <Link href="/finance/income?category=advance&invoice=unlinked" className="underline underline-offset-2">
              {formatNumber(stats.advanceCount)} {stats.advanceCount === 1 ? "receipt" : "receipts"} not linked to an invoice
            </Link>
          ) : (
            "Every advance is applied"
          )
        }
      />
    </StatGrid>
  );

  if (payments) {
    const params = parseListParams(sp, {
      filterKeys: INVOICE_PAYMENT_FILTER_KEYS,
      sortable: INVOICE_PAYMENT_SORT_KEYS,
      defaultSort: { id: "date", desc: true },
    });
    const data = await listInvoicePayments(params);
    const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);
    return (
      <Page>
        {header(
          <>
            <span className="tabular">{formatNumber(data.summary.count)}</span> {data.summary.count === 1 ? "payment" : "payments"} received against invoices ·{" "}
            <Money value={data.summary.total} className="font-medium text-foreground" />
            {filtered ? " (filtered)" : ""}
          </>,
        )}
        {cards}
        <Tabs active="payments" />
        <PaymentsView data={data} invoiceClients={invoiceClients} />
      </Page>
    );
  }

  const params = parseListParams(sp, {
    filterKeys: INVOICE_FILTER_KEYS,
    sortable: INVOICE_SORT_KEYS,
    defaultSort: { id: "date", desc: true },
  });
  const data = await listInvoices(params);
  const filtered = Boolean(params.q || Object.keys(params.filters).length || params.from || params.to);
  return (
    <Page>
      {header(
        <>
          <span className="tabular">{formatNumber(data.summary.count)}</span> {data.summary.count === 1 ? "invoice" : "invoices"} ·{" "}
          <Money value={data.summary.invoiced} className="font-medium text-foreground" /> invoiced,{" "}
          <Money value={data.summary.received} className="font-medium text-foreground" /> received,{" "}
          <Money value={data.summary.outstanding} className="font-medium text-foreground" /> outstanding{filtered ? " (filtered)" : ""}
        </>,
      )}
      {cards}
      <Tabs active="invoices" />
      <InvoicesView data={data} projects={projects} clients={[...new Set([...invoiceClients, ...clients])]} invoiceClients={invoiceClients} accounts={accounts} />
    </Page>
  );
}
