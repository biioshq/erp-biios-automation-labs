import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Landmark, LineChart, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { AdminOnly } from "@/components/shared/admin-only";
import { requireUser } from "@/server/auth/session";
import { getBankAccountOptions } from "@/server/lookups";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { parseListParams, type SearchParams } from "@/lib/list-params";
import { formatCurrency, formatDate } from "@/lib/format";
import { endOfDayIST, toDateInput } from "@/lib/dates";
import { INVESTMENT_ROOT, listInvestments } from "@/features/finance/assets/investments/queries";
import { INVESTMENT_FILTER_KEYS } from "@/features/finance/assets/investments/schemas";
import { InvestmentsView } from "@/features/finance/assets/investments/components/investments-view";
import type { InvestmentRow } from "@/features/finance/assets/investments/types";

export const metadata: Metadata = { title: "Investments" };

const DAY = 24 * 60 * 60 * 1000;

/** Investments still held that mature in the next 90 days, soonest first, from recorded dates only. */
function maturingSoon(rows: InvestmentRow[], now = new Date()): InvestmentRow[] {
  const today = toDateInput(now);
  const limit = toDateInput(endOfDayIST(new Date(now.getTime() + 90 * DAY)));
  return rows
    .filter((r) => r.held && r.maturityDate && toDateInput(r.maturityDate) >= today && toDateInput(r.maturityDate) <= limit)
    .sort((a, b) => a.maturityDate!.localeCompare(b.maturityDate!));
}

export default async function InvestmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Long-term investments" eyebrow="Finance · Assets" />;
  const sp = await searchParams;
  const params = parseListParams(sp, { filterKeys: INVESTMENT_FILTER_KEYS });
  const [list, allGroups, accounts] = await Promise.all([listInvestments({ q: params.q, filters: params.filters }), loadFinanceGroups("asset"), getBankAccountOptions()]);
  const allowed = new Set(descendantsOf(allGroups, INVESTMENT_ROOT));
  const groups = allGroups.filter((g) => allowed.has(g.key));
  const t = list.totals;
  const suffix = list.filtered ? " (filtered)" : "";

  const maturing = maturingSoon(list.rows);
  const valueGap = t.valuedCount ? Math.round((t.value - t.valuedCost) * 100) / 100 : null;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Long-term investments"
        description="Fixed deposits, funds, shares, bonds and property held for more than a year. The balance sheet carries them at cost; current values are shown beside it."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/finance/assets">
                <Landmark /> Assets overview
              </Link>
            </Button>
            <Button asChild>
              <Link href="?new=1" scroll={false}>
                <Plus /> Add investment
              </Link>
            </Button>
          </>
        }
      />
      <StatGrid>
        <StatCard label={`Held at cost${suffix}`} value={<Money value={t.cost} compact />} icon={Wallet} tone="brand" hint={`${t.count} ${t.count === 1 ? "investment" : "investments"} on the balance sheet`} />
        <StatCard
          label={`Current value${suffix}`}
          value={t.valuedCount ? <Money value={t.value} compact /> : "Not recorded"}
          icon={LineChart}
          hint={t.valuedCount ? `${t.valuedCount} of ${t.count} valued, cost of those ${formatCurrency(t.valuedCost)}` : "Add a current value from a statement"}
        />
        <StatCard
          label="Above or below cost"
          value={valueGap === null ? "Not recorded" : <Money value={valueGap} tone="auto" compact />}
          icon={LineChart}
          hint="Valued investments only. Not booked until redeemed."
        />
        <StatCard
          label="Maturing in 90 days, at cost"
          value={maturing.length ? <Money value={maturing.reduce((s, r) => s + r.amount, 0)} compact /> : "None"}
          icon={CalendarClock}
          hint={maturing.length ? `${maturing[0].name} on ${formatDate(maturing[0].maturityDate!)}${maturing.length > 1 ? ` and ${maturing.length - 1} more` : ""}` : "From recorded maturity dates"}
        />
      </StatGrid>
      <InvestmentsView list={list} groups={groups} accounts={accounts} layout={sp.layout === "register" ? "register" : "groups"} />
    </Page>
  );
}
