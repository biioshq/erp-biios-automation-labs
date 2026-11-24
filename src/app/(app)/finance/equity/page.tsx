import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpFromLine, Landmark, Plus, Scale, TrendingUp, UserRound, Users, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IfCan } from "@/features/finance/equity/components/if-can";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { formatDate } from "@/lib/format";
import { getEquitySummary, getPanelData } from "@/features/finance/equity/queries";
import { EquityPanels } from "@/features/finance/equity/components/equity-panels";
import { HoldersTable } from "@/features/finance/equity/components/holders-table";
import { EntriesTable } from "@/features/finance/equity/components/entries-table";
import { StatLink } from "@/features/finance/equity/components/stat-link";

export const metadata: Metadata = { title: "Capital / Equity" };

export default async function EquitySummaryPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.equity:view")) return <NoAccess title="Capital / Equity" />;
  const [data, panel] = await Promise.all([getEquitySummary(), getPanelData()]);
  const { overview } = data;
  const empty = data.holders.length === 0 && data.latest.length === 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance"
        title="Capital / Equity"
        description={
          <>
            What the owners and investors have in the business on {formatDate(overview.asOf)}. These figures are the equity side of the{" "}
            <Link href="/finance/reports/balance-sheet" className="underline-offset-2 hover:underline">
              balance sheet
            </Link>
            . Capital is never counted as income.
          </>
        }
        actions={
          <>
            <IfCan permission="finance.equity:create">
              <Button asChild variant="outline">
                <Link href="/finance/equity/drawings?new=1" scroll={false}>
                  <ArrowUpFromLine /> Record drawing
                </Link>
              </Button>
            </IfCan>
            <IfCan permission="finance.equity:create">
              <Button asChild>
                <Link href="?new=capital" scroll={false}>
                  <Plus /> Record capital
                </Link>
              </Button>
            </IfCan>
          </>
        }
      />

      <StatGrid className="xl:grid-cols-3">
        <StatLink href="/finance/equity/owners" label="Owner's capital" value={<Money value={overview.ownersCapital} />} icon={UserRound} tone="brand" hint="Capital introduced by owners" />
        <StatLink href="/finance/equity/investors" label="Investors' capital" value={<Money value={overview.investorsCapital} />} icon={Users} tone="info" hint="Capital introduced by investors" />
        <StatLink
          href="/finance/equity/retained-earnings"
          label="Retained earnings"
          value={<Money value={overview.retainedEarnings} tone="auto" />}
          icon={TrendingUp}
          tone={overview.retainedEarnings < 0 ? "danger" : "success"}
          hint="Profit kept in the business"
        />
        <StatLink href="/finance/equity/reserves" label="Reserves" value={<Money value={overview.reserves} />} icon={Vault} hint="General and other reserves" />
        <StatLink href="/finance/equity/drawings" label="Drawings" value={<Money value={Math.abs(overview.drawings)} />} icon={ArrowUpFromLine} tone="warning" hint="Taken out by owners" />
        <StatLink
          href="/finance/reports/balance-sheet"
          label="Total equity"
          value={<Money value={overview.total} tone="auto" />}
          icon={Scale}
          tone="default"
          hint="As on the balance sheet"
        />
      </StatGrid>

      {empty ? (
        <EmptyState
          icon={Landmark}
          title="No capital recorded yet"
          description="Add the owners and investors, then record the capital each one put in. Drawings, dividends and reserves follow from here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <IfCan permission="finance.equity:create">
                <Button asChild>
                  <Link href="?new=capital" scroll={false}>
                    <Plus /> Record capital
                  </Link>
                </Button>
              </IfCan>
              <IfCan permission="finance.equity:create">
                <Button asChild variant="outline">
                  <Link href="?holder=new&kind=owner" scroll={false}>
                    <UserRound /> Add owner
                  </Link>
                </Button>
              </IfCan>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Section
            className="xl:col-span-2"
            title="Owners and investors"
            description="Capital in, drawings out and the current balance of each person. Click a name for their history."
            actions={
              <IfCan permission="finance.equity:create">
                <Button asChild size="sm" variant="outline">
                  <Link href="?holder=new" scroll={false}>
                    <Plus /> Add person
                  </Link>
                </Button>
              </IfCan>
            }
            contentClassName="p-0 sm:p-0"
          >
            <div className="p-3 sm:p-4">
              <HoldersTable
                id="equity-holders"
                holders={data.holders}
                mode="mixed"
                emptyState={<EmptyState compact icon={Users} title="Nobody listed yet" description="Add the owners and investors of the company." />}
              />
            </div>
          </Section>
          <Section title="How total equity adds up" description="Each line as on the balance sheet today.">
            <ul className="divide-y text-sm">
              {overview.lines.map((line) => (
                <li key={line.key} className="flex items-center justify-between gap-3 py-2">
                  {line.href ? (
                    <Link href={line.href} className="min-w-0 truncate hover:underline">
                      {line.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate" title={line.key === "opening_balance" ? "Opening balances of accounts, stock and assets entered when the books started" : undefined}>
                      {line.label}
                    </span>
                  )}
                  <Money value={line.amount} tone={line.amount < 0 ? "negative" : undefined} />
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 pt-3 font-semibold">
                <span>Total equity</span>
                <Money value={overview.total} tone="auto" />
              </li>
            </ul>
            {overview.lines.some((l) => l.key === "opening_balance") ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Opening balance equity is the other side of the opening balances entered for accounts, stock and assets. It is part of equity until it is explained by capital or retained earnings.
              </p>
            ) : null}
          </Section>
        </div>
      )}

      {data.latest.length ? (
        <Section title="Latest equity entries" description="Capital, drawings, dividends, reserve transfers and opening figures, newest first." contentClassName="p-3 sm:p-4">
          <EntriesTable id="equity-latest" entries={data.latest} show={["holder", "reserve", "payment"]} hideToolbar />
        </Section>
      ) : null}

      <EquityPanels {...panel} />
    </Page>
  );
}
