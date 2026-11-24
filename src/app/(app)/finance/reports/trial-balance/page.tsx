import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { DownloadButtons } from "@/features/reports/components/download-buttons";
import { ReportFilterBar } from "@/features/reports/components/report-filters";
import { CheckBadge, RelatedStatements, StatementMatrix } from "@/features/reports/components/statements/statement-view";
import { filtersForReport, parseReportFilters } from "@/features/reports/schemas";
import type { ReportColumn, ReportRow } from "@/features/reports/types";
import { trialBalance } from "@/server/accounting/statements";
import { can, requireUser } from "@/server/auth/session";
import type { AccountType, TrialBalanceRow } from "@/lib/accounting";
import { fromDateInput } from "@/lib/dates";
import { formatDate, formatNumber, round2 } from "@/lib/format";

export const metadata: Metadata = { title: "Trial balance" };

const NO_OPTIONS = { projects: [], vendors: [], categories: [] };

const COLUMNS: ReportColumn[] = [
  { key: "account", header: "Account", type: "text", width: 40 },
  { key: "debit", header: "Debit", type: "money", width: 18 },
  { key: "credit", header: "Credit", type: "money", width: 18 },
];

const TYPE_HEADINGS: { type: AccountType; label: string }[] = [
  { type: "asset", label: "Assets" },
  { type: "liability", label: "Liabilities" },
  { type: "equity", label: "Equity" },
  { type: "income", label: "Income" },
  { type: "expense", label: "Expenses" },
];

/** The accounts under a heading per type, each type with its own debit and credit totals. */
function tableRows(rows: TrialBalanceRow[], debit: number, credit: number): ReportRow[] {
  const out: ReportRow[] = [];
  for (const t of TYPE_HEADINGS) {
    const inType = rows.filter((r) => r.type === t.type);
    if (!inType.length) continue;
    out.push({ account: t.label, debit: null, credit: null, _kind: "subtotal" });
    for (const r of inType) out.push({ account: `    ${r.name}`, debit: r.debit || null, credit: r.credit || null });
    out.push({
      account: `Total ${t.label.toLowerCase()}`,
      debit: round2(inType.reduce((s, r) => s + r.debit, 0)),
      credit: round2(inType.reduce((s, r) => s + r.credit, 0)),
      _kind: "subtotal",
    });
  }
  out.push({ account: "Total of all accounts", debit, credit, _kind: "subtotal" });
  return out;
}

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!can(user, "finance.statements:view")) return <NoAccess title="Trial balance" />;
  const filters = filtersForReport("trial_balance", parseReportFilters(await searchParams));
  const tb = await trialBalance(filters.to ? fromDateInput(filters.to) : null);
  const day = formatDate(fromDateInput(tb.asOf));

  return (
    <Page>
      <PageHeader
        eyebrow="Reports"
        title="Trial balance"
        description={`The balance of every ledger account on ${day}. Each record is read as a debit and an equal credit, so the two columns must add up to the same figure.`}
        actions={can(user, "finance.statements:export") ? <DownloadButtons type="trial_balance" filters={filters} refreshOnDownload={false} /> : undefined}
      />
      <ReportFilterBar meta={{ type: "trial_balance", filters: ["asOf"] }} filters={filters} options={NO_OPTIONS} />

      {tb.rows.length === 0 ? (
        <EmptyState icon={ListChecks} title="No account has a balance on this day" description="No record is dated on or before this day. Pick a later date." />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Accounts with a balance" value={formatNumber(tb.rows.length)} hint={day} />
            <StatCard label="Total debits" value={<Money value={tb.debit} />} hint="Assets and expenses, mostly" />
            <StatCard label="Total credits" value={<Money value={tb.credit} />} hint="Liabilities, equity and income, mostly" />
            <StatCard label="Debits against credits" value={<CheckBadge difference={round2(tb.debit - tb.credit)} />} hint="The two columns must be equal" />
          </StatGrid>

          <Section
            title="Accounts"
            description="Debit balances are assets and expenses; credit balances are liabilities, equity and income. An account on the other side than usual (an overdrawn bank, for example) is worth a look."
          >
            <StatementMatrix columns={COLUMNS} rows={tableRows(tb.rows, tb.debit, tb.credit)} caption={`Trial balance as of ${day}`} />
          </Section>
        </>
      )}

      <RelatedStatements current="/finance/reports/trial-balance" />
    </Page>
  );
}
