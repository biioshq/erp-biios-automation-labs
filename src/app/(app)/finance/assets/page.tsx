import type { Metadata } from "next";
import Link from "next/link";
import { Armchair, Boxes, Building2, CalendarRange, HandCoins, Landmark, Layers, PiggyBank, Scale, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { AdminOnly } from "@/components/shared/admin-only";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { descendantsOf, loadFinanceGroups } from "@/server/finance-groups";
import { getAssetsOverview } from "@/features/finance/assets/overview/queries";
import { AssetLines } from "@/features/finance/assets/overview/components/asset-lines";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";

export const metadata: Metadata = { title: "Assets overview" };

function StatLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </Link>
  );
}

const PAGES = [
  { href: "/finance/assets/cash", label: "Cash & bank", icon: Landmark, hint: "Accounts, balances, transfers" },
  { href: "/finance/assets/receivables", label: "Receivables", icon: HandCoins, hint: "What customers owe on invoices" },
  { href: "/finance/assets/prepaid", label: "Prepaid expenses", icon: CalendarRange, hint: "Paid in advance, not used yet" },
  { href: "/finance/assets/inventory", label: "Inventory valuation", icon: Boxes, hint: "Storage, in use, wasted" },
  { href: "/finance/assets/fixed", label: "Fixed assets", icon: Armchair, hint: "Register and book values" },
  { href: "/finance/assets/investments", label: "Investments", icon: PiggyBank, hint: "Deposits, funds, shares" },
] as const;

/**
 * Groups a new subgroup may go under: only those whose records can pick it (fixed assets,
 * intangibles, investments and the "other" groups). Cash, stock, receivables and prepaid are
 * worked out from other records, so a subgroup under them would always stay empty.
 */
const HOLDS_RECORDS = {
  current_assets: ["other_current_assets"],
  non_current_assets: ["fixed_assets", "intangible_assets", "long_term_investments", "other_long_term_assets"],
} as const;
type GroupOption = Awaited<ReturnType<typeof loadFinanceGroups>>[number];
function subgroupParents(groups: GroupOption[], root: keyof typeof HOLDS_RECORDS): GroupOption[] {
  const keys = new Set(HOLDS_RECORDS[root].flatMap((k) => descendantsOf(groups, k)));
  return groups.filter((g) => !g.archived && keys.has(g.key));
}

export default async function AssetsOverviewPage() {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Assets overview" />;
  const [data, groups] = await Promise.all([getAssetsOverview(), loadFinanceGroups("asset")]);
  const asOf = formatDate(fromDateInput(data.asOf));

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Assets overview"
        description={<>What the company owns on {asOf}, from the same books as the balance sheet. Each line opens the page that holds its records.</>}
        actions={
          <Button variant="outline" asChild>
            <Link href="/finance/reports/balance-sheet">
              <Scale /> Balance sheet
            </Link>
          </Button>
        }
      />

      <StatGrid className="xl:grid-cols-3">
        <StatCard label="Total assets" value={<Money value={data.totalAssets} tone="auto" />} icon={Building2} tone="brand" hint={`On ${asOf}`} />
        <StatCard label="Current assets" value={<Money value={data.currentAssets} tone="auto" />} icon={Wallet} tone="info" hint="Cash, stock, receivables, prepaid" />
        <StatCard label="Non-current assets" value={<Money value={data.nonCurrentAssets} tone="auto" />} icon={Layers} tone="default" hint="Fixed, intangible, investments" />
        <StatLink href="/finance/assets/inventory">
          <StatCard label="Inventory value" value={<Money value={data.inventory} tone="auto" />} icon={Boxes} tone="success" hint="Stock in storage, at cost" className="h-full" />
        </StatLink>
        <StatLink href="/finance/assets/fixed">
          <StatCard
            label="Fixed assets value"
            value={<Money value={data.fixedAssets} tone="auto" />}
            icon={Armchair}
            tone="default"
            hint="Net book value, intangibles included"
            className="h-full"
          />
        </StatLink>
        <StatLink href="/finance/assets/inventory?tab=wasted">
          <StatCard
            label="Wastage value, all time"
            value={<Money value={data.wastage.allTime} />}
            icon={Trash2}
            tone="danger"
            hint={
              <>
                <Money value={data.wastage.year} /> in {data.wastage.yearLabel}
              </>
            }
            className="h-full"
          />
        </StatLink>
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Section
          title="Current assets"
          description="Cash and what turns into cash within a year"
          actions={<AddSubgroupButton parents={subgroupParents(groups, "current_assets")} defaultParent="other_current_assets" label="Add subgroup" variant="ghost" />}
        >
          <AssetLines root="current_assets" lines={data.current} total={data.currentAssets} totalLabel="Total current assets" />
        </Section>
        <Section
          title="Non-current assets"
          description="What the business keeps and uses for more than a year"
          actions={<AddSubgroupButton parents={subgroupParents(groups, "non_current_assets")} defaultParent="fixed_assets" label="Add subgroup" variant="ghost" />}
        >
          <AssetLines root="non_current_assets" lines={data.nonCurrent} total={data.nonCurrentAssets} totalLabel="Total non-current assets" />
        </Section>
      </div>

      <Section title="Asset pages" description="Records behind each line" contentClassName="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="flex items-center gap-3 rounded-lg border bg-surface/40 px-3 py-2.5 transition-colors hover:border-foreground/20 hover:bg-muted/40">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand-ink">
              <p.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{p.hint}</span>
            </span>
          </Link>
        ))}
      </Section>

      <p className="text-xs text-muted-foreground">
        Wastage value is the cost of every unit written off as damaged, expired, lost or scrap, from storage or while in use on a project. Stock wasted
        from storage leaves Inventory; stock wasted on a project was already charged to that project.
      </p>
    </Page>
  );
}
