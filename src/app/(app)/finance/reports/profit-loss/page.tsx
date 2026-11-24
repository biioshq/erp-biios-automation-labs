import type { Metadata } from "next";
import Link from "next/link";
import { ChartLine } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { DownloadButtons } from "@/features/reports/components/download-buttons";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { InvertedPeriod, RelatedStatements, StatementMatrix, defaultPeriodLabel } from "@/features/reports/components/statements/statement-view";
import { filtersForReport, parseReportFilters, reportQueryString } from "@/features/reports/schemas";
import { PL_NOTES, plColumnsOf, plRows } from "@/features/reports/server/builders/statements";
import { plColumns } from "@/features/reports/server/pl-columns";
import type { PlColumns } from "@/features/reports/types";
import { periodFromInputs } from "@/server/accounting/statements";
import { can, requireUser } from "@/server/auth/session";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Profit & loss" };

const NO_OPTIONS = { projects: [], vendors: [], categories: [] };

const LAYOUT_WORDS: Record<PlColumns, string> = { total: "one total", month: "monthly", quarter: "quarterly", year: "yearly" };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "finance.statements:view")) return <NoAccess title="Profit & loss" />;
  const filters = filtersForReport("profit_loss", parseReportFilters(await searchParams));
  // A hand-edited link can put the start after the end: the downloads refuse it, so the page says so too.
  if (filters.from && filters.to && filters.from > filters.to) return <InvertedPeriod title="Profit & loss" filters={filters} />;
  const period = periodFromInputs(filters.from, filters.to);
  const data = await plColumns(period.from, period.to, filters.columns ?? "total");
  const { columns, keys, results } = plColumnsOf(data);
  const pl = data.total;
  const rows = plRows(results, keys);
  const periodWords = `${formatDate(fromDateInput(pl.from))} to ${formatDate(fromDateInput(pl.to))}`;
  const margin = pl.totalIncome > 0 ? formatPercent(pl.profit / pl.totalIncome) : null;
  const periodQuery = reportQueryString({ from: pl.from, to: pl.to });

  return (
    <Page>
      <PageHeader
        eyebrow="Reports"
        title="Profit & loss"
        description={`Income earned against costs incurred from ${periodWords}, on the accrual basis. Every figure is computed from the records in Project Manager.`}
        actions={can(user, "finance.statements:export") ? <DownloadButtons type="profit_loss" filters={filters} refreshOnDownload={false} /> : undefined}
      />
      <ReportFilterBar meta={{ type: "profit_loss", filters: ["date", "columns"] }} filters={filters} options={NO_OPTIONS} dateLabel={defaultPeriodLabel(filters, pl.from, pl.to)} />

      {pl.sections.length === 0 ? (
        <EmptyState
          icon={ChartLine}
          title="No income or expense in this period"
          description="No invoice, income, expense, stock use or depreciation is dated in this period. Pick a longer period or another year."
        />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Total income" value={<Money value={pl.totalIncome} />} hint="Revenue and other income" />
            <StatCard label="Total expenses" value={<Money value={pl.totalExpenses} />} hint="Expense in the P&L, GST excluded" />
            <StatCard label="Gross profit" value={<Money value={pl.grossProfit} tone="auto" />} hint="Revenue less materials and direct costs" />
            <StatCard label="Net profit" value={<Money value={pl.profit} tone="auto" />} hint={margin ? `${margin} of total income` : "No income in the period"} />
          </StatGrid>

          <Section
            title="Statement"
            description={
              data.mode !== data.requested
                ? `A ${LAYOUT_WORDS[data.requested]} view of this period would need more than 24 columns, so it is shown ${LAYOUT_WORDS[data.mode]}.`
                : data.mode === "total"
                  ? "Switch to monthly, quarterly or yearly columns to compare sub-periods. Quarters and years follow the April to March financial year."
                  : "Each column is the statement for that sub-period, the first and last cut to the period chosen. The total column covers the whole period."
            }
          >
            <StatementMatrix columns={columns} rows={rows} caption={`Profit and loss, ${periodWords}`} />
          </Section>
        </>
      )}

      <Section title="How to read it">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted-foreground">
          {PL_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
          <li>
            For cash spent on bills in the same period (GST and stock purchases included), see the{" "}
            <Link href={`/finance/reports?report=expense${periodQuery ? `&${periodQuery}` : ""}`} className="text-foreground underline underline-offset-4">
              expense report
            </Link>{" "}
            or the{" "}
            <Link href={`/finance/reports/cash-flow${periodQuery ? `?${periodQuery}` : ""}`} className="text-foreground underline underline-offset-4">
              cash flow statement
            </Link>
            .
          </li>
        </ul>
      </Section>

      <RelatedStatements current="/finance/reports/profit-loss" extra={[{ href: "/finance/projects/profitability", label: "Project profitability" }, { href: "/finance/expenses/summary", label: "Expense summary" }]} />
    </Page>
  );
}
