import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Banknote, Info, Landmark, Plus, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { can, requireUser } from "@/server/auth/session";
import { getAccountHistory, getCashOverview, listTransfers, transferOptions } from "@/features/finance/assets/accounts/queries";
import { AccountsGrid } from "@/features/finance/assets/accounts/components/accounts-grid";
import { AccountHistoryPanel } from "@/features/finance/assets/accounts/components/account-history";
import { TransfersTable } from "@/features/finance/assets/accounts/components/transfers-table";

export const metadata: Metadata = { title: "Cash & bank" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const isDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

const ROUTE_REASON = {
  default: "set as its default",
  first_of_kind: "the first account of that type, as no default is set",
  not_set_up: "no account set up yet",
} as const;

export default async function CashAndBankPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "finance.cash_bank:view")) return <NoAccess title="Cash & bank" />;

  const params = await searchParams;
  const overview = await getCashOverview();
  const requested = one(params.account);
  const code = overview.accounts.some((a) => a.code === requested) ? requested! : (overview.accounts[0]?.code ?? null);
  const [history, transfers] = await Promise.all([
    code ? getAccountHistory(code, isDay(one(params.from)), isDay(one(params.to)), overview.accounts) : Promise.resolve(null),
    listTransfers(),
  ]);
  const transferAccounts = transferOptions(overview.accounts);
  const open = overview.accounts.filter((a) => a.id && !a.archived);
  const canCreate = can(user, "finance.cash_bank:create");

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Cash & bank"
        description={
          <>
            Cash in hand and bank balances on {formatDate(fromDateInput(overview.asOf))}, worked out from each account&apos;s opening balance and every
            expense, income, loan, capital entry and transfer recorded against it.
          </>
        }
        actions={
          canCreate ? (
            <>
              <Button variant="outline" asChild>
                <Link href="?transfer=1" scroll={false}>
                  <ArrowLeftRight /> Record transfer
                </Link>
              </Button>
              <Button asChild>
                <Link href="?new=1" scroll={false}>
                  <Plus /> Add account
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />

      {overview.noAccounts || overview.usesFallback ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
            <TriangleAlert className="size-[18px]" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-warning">{overview.noAccounts ? "Set up your bank accounts and cash box" : "Some records land in an account that is not set up"}</p>
            <p className="mt-0.5 text-muted-foreground">
              {overview.noAccounts
                ? "Until accounts are added, money paid and received is kept in two stand-in accounts below (Bank and Cash, no account set up). Add each real account with its opening balance and pick which payment methods it is the default for."
                : "Records that name no account and whose payment method has no default go to a stand-in account. Pick a default account for that method, or add the missing account."}
            </p>
          </div>
        </div>
      ) : null}

      <StatGrid>
        <StatCard label="Total available cash" value={<Money value={overview.total} tone="auto" />} icon={Wallet} tone="brand" hint="Bank balances plus cash in hand" />
        <StatCard label="Bank balances" value={<Money value={overview.bankBalance} tone="auto" />} icon={Landmark} tone="info" hint={`${overview.accounts.filter((a) => a.kind === "bank").length} bank accounts`} />
        <StatCard label="Cash in hand" value={<Money value={overview.cashInHand} tone="auto" />} icon={Banknote} tone="success" hint={`${overview.accounts.filter((a) => a.kind === "cash").length} cash boxes`} />
        <StatCard label="Transfers recorded" value={transfers.total} icon={ArrowLeftRight} hint="Between your own accounts" />
      </StatGrid>

      <Section
        title="Accounts"
        description="Balance today in each bank account and cash box. Archived accounts still count while they hold money."
        actions={
          <div className="flex items-center gap-3 text-xs font-medium">
            {can(user, "finance.bank_statements:view") ? (
              <Link href="/finance/bank-statements" className="text-brand-ink hover:underline">
                Bank statements
              </Link>
            ) : null}
            {can(user, "finance.statements:view") ? (
              <Link href="/finance/reports/cash-flow" className="text-brand-ink hover:underline">
                Cash flow
              </Link>
            ) : null}
            {can(user, "finance.assets_overview:view") ? (
              <Link href="/finance/assets" className="text-brand-ink hover:underline">
                Assets overview
              </Link>
            ) : null}
          </div>
        }
      >
        <AccountsGrid accounts={overview.accounts} transferAccounts={transferAccounts} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <Section title="How balances are worked out" contentClassName="space-y-3 text-sm text-muted-foreground" className="xl:col-span-1">
          <p className="flex gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-info" />
            <span>
              Each account starts from its opening balance on its opening date. Records dated before an account&apos;s opening date are part of that opening
              balance, so they do not change it again.
            </span>
          </p>
          <p>A record that names an account uses it. One that does not lands in the account set as the default for its payment method:</p>
          <ul className="divide-y rounded-lg border">
            {overview.routes.map((r) => (
              <li key={r.method} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="font-medium text-foreground">{r.label}</span>
                <span className="text-right text-xs">
                  <span className={r.reason === "not_set_up" ? "text-warning" : "text-foreground"}>{r.accountName}</span>
                  <span className="block">{ROUTE_REASON[r.reason]}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs">Payments through Biios Startup LLP are owed to the group company, and stock taken from inventory moves no money, so neither touches an account.</p>
        </Section>

        <div id="history" className="min-w-0 scroll-mt-20 xl:col-span-2">
          <Section title="Transactions" description="One account at a time, newest first, with the balance after each record.">
            <AccountHistoryPanel accounts={overview.accounts} history={history} />
          </Section>
        </div>
      </div>

      <Section
        title="Transfers between own accounts"
        description={open.length < 2 ? "Add at least two accounts to record a transfer." : "Neither income nor expense: money leaves one account and arrives in the other on the same day."}
        actions={
          open.length >= 2 && canCreate ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="?transfer=1" scroll={false}>
                <Plus /> Record transfer
              </Link>
            </Button>
          ) : null
        }
      >
        <TransfersTable rows={transfers.rows} canAdd={open.length >= 2 && canCreate} />
        {transfers.total > transfers.rows.length ? (
          <p className="mt-3 text-xs text-muted-foreground">Showing the latest {transfers.rows.length} of {transfers.total} transfers. Each account&apos;s transactions above list every one.</p>
        ) : null}
      </Section>
    </Page>
  );
}
