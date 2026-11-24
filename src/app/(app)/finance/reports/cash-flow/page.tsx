import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { DownloadButtons } from "@/features/reports/components/download-buttons";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { CheckBadge, GrandTotal, InvertedPeriod, RelatedStatements, StatementBlock, StatementMatrix } from "@/features/reports/components/statements/statement-view";
import { filtersForReport, parseReportFilters } from "@/features/reports/schemas";
import type { ReportColumn, ReportRow } from "@/features/reports/types";
import { cashFlow, periodFromInputs } from "@/server/accounting/statements";
import { can, requireUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";

export const metadata: Metadata = { title: "Cash flow statement" };

const NO_OPTIONS = { projects: [], vendors: [], categories: [] };

const ACCOUNT_COLUMNS: ReportColumn[] = [
  { key: "account", header: "Account", type: "text", width: 30 },
  { key: "opening", header: "Opening", type: "money", width: 16 },
  { key: "inflow", header: "Money in", type: "money", width: 16 },
  { key: "outflow", header: "Money out", type: "money", width: 16 },
  { key: "closing", header: "Closing", type: "money", width: 16 },
];

const ACTIVITY_HINTS = {
  operating: "Receipts from customers, payments to suppliers, salaries and other running costs.",
  investing: "Buying and selling fixed assets and investments.",
  financing: "Capital, drawings, dividends and loans taken or repaid.",
} as const;

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "finance.statements:view")) return <NoAccess title="Cash flow statement" />;
  const filters = filtersForReport("cash_flow", parseReportFilters(await searchParams));
  // A hand-edited link can put the start after the end: the downloads refuse it, so the page says so too.
  if (filters.from && filters.to && filters.from > filters.to) return <InvertedPeriod title="Cash flow statement" filters={filters} />;
  const period = periodFromInputs(filters.from, filters.to);
  const cf = await cashFlow(period.from, period.to);
  const periodWords = `${formatDate(fromDateInput(cf.from))} to ${formatDate(fromDateInput(cf.to))}`;
  const net = (key: "operating" | "investing" | "financing") => cf.activities.find((a) => a.key === key)?.net ?? 0;
  // Opening cash plus the three activities must give closing cash: transfers between own accounts net to zero.
  const difference = round2(cf.opening + net("operating") + net("investing") + net("financing") - cf.closing);

  const accountRows: ReportRow[] = cf.accounts.map((a) => ({ account: a.name, opening: a.opening, inflow: a.inflow, outflow: a.outflow, closing: a.closing }));
  const sum = (k: "opening" | "inflow" | "outflow" | "closing") => round2(cf.accounts.reduce((s, a) => s + a[k], 0));
  if (accountRows.length > 1) accountRows.push({ account: "Total", opening: sum("opening"), inflow: sum("inflow"), outflow: sum("outflow"), closing: sum("closing"), _kind: "subtotal" });

  return (
    <Page>
      <PageHeader
        eyebrow="Reports"
        title="Cash flow statement"
        description={`Cash received and paid from ${periodWords}, by activity (direct method). Only money that moved through a cash or bank account counts.`}
        actions={can(user, "finance.statements:export") ? <DownloadButtons type="cash_flow" filters={filters} refreshOnDownload={false} /> : undefined}
      />
      <ReportFilterBar meta={{ type: "cash_flow", filters: ["date"] }} filters={filters} options={NO_OPTIONS} />

      {cf.accounts.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No cash or bank account has any money recorded"
          description="Set up the company's bank accounts and cash in hand with their opening balances, then link receipts and payments to them."
          action={
            <Button asChild size="sm">
              <Link href="/finance/assets/cash">Open Cash &amp; bank</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Opening cash" value={<Money value={cf.opening} tone="auto" />} hint={formatDate(fromDateInput(cf.from))} />
            <StatCard label="Net change in cash" value={<Money value={cf.netChange} tone="auto" />} hint="Closing less opening" />
            <StatCard label="Closing cash" value={<Money value={cf.closing} tone="auto" />} hint={formatDate(fromDateInput(cf.to))} />
            <StatCard label="Opening plus activities against closing" value={<CheckBadge difference={difference} balancedText="Agrees" />} hint="The activities explain the change" />
          </StatGrid>

          <div className="grid items-start gap-5 lg:grid-cols-3">
            {cf.activities.map((a) => (
              <Section key={a.key} title={a.label} description={ACTIVITY_HINTS[a.key]}>
                <StatementBlock
                  title="Cash in, and cash out as negative"
                  lines={a.lines}
                  total={a.net}
                  totalLabel={`Net cash from ${a.key} activities`}
                  empty="No cash moved for these activities in the period."
                />
              </Section>
            ))}
          </div>

          <Section title="Reconciliation">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 px-3 text-sm">
                <span>Cash at the start of the period</span>
                <Money value={cf.opening} exact tone="auto" />
              </div>
              {cf.activities.map((a) => (
                <div key={a.key} className="flex items-baseline justify-between gap-3 px-3 text-sm text-muted-foreground">
                  <span>Net cash from {a.key} activities</span>
                  <Money value={a.net} exact tone="auto" />
                </div>
              ))}
              <GrandTotal label="Cash at the end of the period" value={cf.closing} />
            </div>
          </Section>

          <Section
            title="Cash by account"
            description="Opening, money in, money out and closing for each cash and bank account. Transfers between the company's own accounts show here as money out of one and into the other; in the statement above they cancel out."
          >
            <StatementMatrix columns={ACCOUNT_COLUMNS} rows={accountRows} caption={`Cash by account, ${periodWords}`} />
          </Section>
        </>
      )}

      <RelatedStatements current="/finance/reports/cash-flow" extra={[{ href: "/finance/assets/cash", label: "Cash & bank" }, { href: "/finance/reports?report=cash_budget", label: "Cash flow & budget report" }]} />
    </Page>
  );
}
