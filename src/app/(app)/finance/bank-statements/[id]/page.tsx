import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarRange, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { AdminOnly } from "@/components/shared/admin-only";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getStatementLines } from "@/features/finance/bank-statements/queries";
import { StoredLinesTable } from "@/features/finance/bank-statements/components/stored-lines";

export const metadata: Metadata = { title: "Bank statement" };

// Adding a line again runs as this page's server action.
export const maxDuration = 60;

export default async function BankStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Bank statement" />;
  const { id } = await params;
  const data = await getStatementLines(id);
  if (!data) notFound();
  const { statement: s, lines } = data;
  // ?line=<id>: the line a link points at, scrolled to and highlighted.
  const asked = (await searchParams).line;
  const focus = typeof asked === "string" ? asked : null;
  const focusMissing = Boolean(focus && !lines.some((l) => l.id === focus));
  const deposits = lines.reduce((t, l) => t + l.deposit, 0);
  const withdrawals = lines.reduce((t, l) => t + l.withdrawal, 0);
  const period = s.from && s.to ? (s.from === s.to ? formatDate(s.from) : `${formatDate(s.from)} to ${formatDate(s.to)}`) : "No dates";

  return (
    <Page>
      <PageHeader
        eyebrow="Bank statements"
        title={`${s.accountName}, ${period}`}
        description={`${s.fileName ? `${s.fileName}, uploaded` : "Uploaded"} ${formatDateTime(s.createdAt)}${s.createdBy ? ` by ${s.createdBy}` : ""}. Each line links to the record it became.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/finance/bank-statements">
              <ArrowLeft /> All statements
            </Link>
          </Button>
        }
      />
      <StatGrid>
        <StatCard compact label="Statement period" icon={CalendarRange} value={<span className="text-base sm:text-lg">{period}</span>} hint={`${formatNumber(s.lines)} lines in the file`} />
        <StatCard
          compact
          label="Lines dealt with"
          icon={ListChecks}
          value={formatNumber(s.added + s.matched + s.ignored)}
          hint={`${formatNumber(s.added)} added, ${formatNumber(s.matched)} matched, ${formatNumber(s.ignored)} ignored`}
        />
        <StatCard compact label="Deposits in these lines" icon={ArrowDownLeft} tone="success" value={<Money value={deposits} exact />} />
        <StatCard compact label="Withdrawals in these lines" icon={ArrowUpRight} tone="danger" value={<Money value={withdrawals} exact />} />
      </StatGrid>
      <Section
        title="Lines"
        description={
          s.openingBalance !== null || s.closingBalance !== null ? (
            <>
              Opening balance {s.openingBalance === null ? "not shown" : <Money value={s.openingBalance} exact />}, closing balance{" "}
              {s.closingBalance === null ? "not shown" : <Money value={s.closingBalance} exact />} as printed on the statement.
            </>
          ) : (
            "The statement printed no balances."
          )
        }
      >
        {focusMissing ? (
          <p className="mb-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm" role="status">
            The line you followed a link to is not on this statement.{" "}
            <Link href={`/finance/bank-statements?line=${encodeURIComponent(focus ?? "")}`} className="font-medium text-brand-ink underline-offset-2 hover:underline">
              Find it
            </Link>
          </p>
        ) : null}
        <StoredLinesTable
          lines={lines}
          focus={focus}
          statement={{ id: s.id, fileName: (s.fileName ?? "").slice(0, 260), from: s.from, to: s.to, opening: s.openingBalance, closing: s.closingBalance, lines: s.lines }}
        />
      </Section>
    </Page>
  );
}
