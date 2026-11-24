import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { DownloadButtons } from "@/features/reports/components/download-buttons";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { CheckBadge, GrandTotal, RelatedStatements, StatementBlock } from "@/features/reports/components/statements/statement-view";
import { filtersForReport, parseReportFilters } from "@/features/reports/schemas";
import { balanceSheet } from "@/server/accounting/statements";
import { can, requireUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";

export const metadata: Metadata = { title: "Balance sheet" };

const NO_OPTIONS = { projects: [], vendors: [], categories: [] };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "finance.statements:view")) return <NoAccess title="Balance sheet" />;
  const filters = filtersForReport("balance_sheet", parseReportFilters(await searchParams));
  const sheet = await balanceSheet(filters.to ? fromDateInput(filters.to) : null);
  const empty = !sheet.assets.current.length && !sheet.assets.nonCurrent.length && !sheet.liabilities.current.length && !sheet.liabilities.nonCurrent.length && sheet.equity.total === 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Reports"
        title="Balance sheet"
        description={`What the company owns, owes and is worth on ${formatDate(fromDateInput(sheet.asOf))}. Every figure is computed from the records in Project Manager; nothing is typed in by hand.`}
        actions={can(user, "finance.statements:export") ? <DownloadButtons type="balance_sheet" filters={filters} refreshOnDownload={false} /> : undefined}
      />
      <ReportFilterBar meta={{ type: "balance_sheet", filters: ["asOf"] }} filters={filters} options={NO_OPTIONS} />

      {empty ? (
        <EmptyState icon={Scale} title="Nothing recorded up to this day" description="No asset, liability or equity record is dated on or before this day. Pick a later date." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Total assets" value={<Money value={sheet.assets.total} />} hint={`${formatDate(fromDateInput(sheet.asOf))}`} />
            <StatCard label="Total liabilities" value={<Money value={sheet.liabilities.total} />} hint="Current and non-current" />
            <StatCard label="Total equity" value={<Money value={sheet.equity.total} tone="auto" />} hint="Capital, reserves and retained earnings" />
            <StatCard label="Assets against liabilities and equity" value={<CheckBadge difference={sheet.difference} />} hint="The two sides must be equal" />
          </StatGrid>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Section title="Assets" description="Current assets turn into cash within a year; non-current ones are kept and used longer.">
              <div className="space-y-5">
                <StatementBlock title="Current assets" lines={sheet.assets.current} total={sheet.assets.totalCurrent} />
                <StatementBlock title="Non-current assets" lines={sheet.assets.nonCurrent} total={sheet.assets.totalNonCurrent} empty="No fixed assets or investments recorded." />
                <GrandTotal label="Total assets" value={sheet.assets.total} />
              </div>
            </Section>
            <Section title="Liabilities and equity" description="What is owed (due within a year, then later), and what belongs to the owners and investors.">
              <div className="space-y-5">
                <StatementBlock title="Current liabilities" lines={sheet.liabilities.current} total={sheet.liabilities.totalCurrent} />
                <StatementBlock title="Non-current liabilities" lines={sheet.liabilities.nonCurrent} total={sheet.liabilities.totalNonCurrent} empty="No long-term loans recorded." />
                <GrandTotal label="Total liabilities" value={sheet.liabilities.total} />
                <StatementBlock title="Equity" lines={sheet.equity.lines} total={sheet.equity.total} />
                <GrandTotal label="Total liabilities and equity" value={round2(sheet.liabilities.total + sheet.equity.total)} />
              </div>
            </Section>
          </div>

          <Section title="How these figures are worked out">
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted-foreground">
              <li>Cash and bank balances start from each account&apos;s opening balance and add every receipt and payment linked to it.</li>
              <li>Inventory is stock in storage at cost. Stock assigned to a project has already become that project&apos;s cost.</li>
              <li>GST input credit and GST charged on invoices are netted into one line: payable when more was charged than paid.</li>
              <li>Retained earnings are every year&apos;s profit or loss less dividends and transfers to reserves. This financial year&apos;s result is shown on its own line.</li>
              <li>Opening balance equity holds balances that existed before the books started (opening bank balances, stock on hand, assets owned).</li>
            </ul>
          </Section>
        </>
      )}

      <RelatedStatements current="/finance/reports/balance-sheet" extra={[{ href: "/finance/assets", label: "Assets overview" }, { href: "/finance/liabilities", label: "Liabilities overview" }, { href: "/finance/equity", label: "Equity summary" }]} />
    </Page>
  );
}
