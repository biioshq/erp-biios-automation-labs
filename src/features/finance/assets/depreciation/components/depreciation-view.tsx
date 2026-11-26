import Link from "next/link";
import { Armchair, KeyRound, Layers, Receipt, TrendingDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { parseDepreciationPeriod } from "@/features/finance/assets/depreciation/period";
import { depreciationSummary } from "@/features/finance/assets/depreciation/queries";
import { PeriodControls } from "@/features/finance/assets/depreciation/components/period-controls";
import { AssetTable, GroupTable } from "@/features/finance/assets/depreciation/components/depreciation-tables";

const CHARGE_LABEL = { tangible: "Depreciation in period", intangible: "Amortization in period" } as const;

export const DEPRECIATION_TITLE = { tangible: "Depreciation on assets", intangible: "Amortization" } as const;

/**
 * Depreciation of fixed assets (Fixed assets › Depreciation on assets) or amortization of intangible
 * assets (Intangible assets › Amortization): one kind per page, reached from inside its register.
 */
export async function DepreciationView({ searchParams, kind }: { searchParams: Promise<SearchParams>; kind: "tangible" | "intangible" }) {
  const user = await requireUser();
  const title = DEPRECIATION_TITLE[kind];
  const register = kind === "intangible" ? { href: "/finance/assets/intangible", label: "Intangible assets" } : { href: "/finance/assets/fixed", label: "Fixed assets" };
  if (!can(user, "finance.fixed_assets:view")) return <NoAccess title={title} eyebrow={`Finance · Assets · ${register.label}`} />;
  const sp = await searchParams;
  const period = parseDepreciationPeriod(sp);
  const data = await depreciationSummary(period.from, period.to, kind);
  const t = data.totals;
  const range = `${formatDate(fromDateInput(period.from))} to ${formatDate(fromDateInput(period.to))}`;
  const periodText = period.mode === "fy" ? `${period.label}${period.toToday ? ", up to today" : ""}` : range;
  const chargeLabel = CHARGE_LABEL[kind];
  const midMonth = period.mode === "custom" && !period.from.endsWith("-01");

  return (
    <Page>
      <PageHeader
        eyebrow={`Finance · Assets · ${register.label}`}
        title={title}
        description={
          kind === "intangible"
            ? "Amortization of software, licences and other intangible assets over time, per group and per asset. Figures use the same calculation as the balance sheet and the profit and loss."
            : "Depreciation of furniture, machinery, vehicles, computers and other fixed assets over time, per group and per asset. Figures use the same calculation as the balance sheet and the profit and loss."
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={register.href}>
              {kind === "intangible" ? <KeyRound /> : <Armchair />} {register.label}
            </Link>
          </Button>
        }
      />
      <PeriodControls period={period} years={data.years} kind={kind} showKind={false} />
      <p className="-mt-3 text-xs text-muted-foreground">
        {periodText}. Cost, accumulated and book value are as at {formatDate(fromDateInput(period.to))}, for assets still held that day.
        {midMonth
          ? " This period starts inside a month: the charge here counts only its days, while the profit and loss books a whole month's charge on the month's last day, so the two can differ."
          : ""}
      </p>

      <StatGrid>
        <StatCard label={chargeLabel} value={<Money value={t.charged} compact />} icon={TrendingDown} tone="brand" hint={periodText} />
        <StatCard label="Original cost" value={<Money value={t.cost} compact />} icon={Receipt} hint={`${t.count} ${t.count === 1 ? "asset" : "assets"} held`} />
        <StatCard label="Accumulated" value={<Money value={t.accumulated} compact />} icon={Layers} hint="Charged from purchase to the end of the period" />
        <StatCard label="Book value" value={<Money value={t.bookValue} compact />} icon={Wallet} hint="Cost less accumulated" />
      </StatGrid>


      {data.assets.length ? (
        <>
          <Section title="By group" description="Each category with its subgroups. A category's figures include its subgroups." contentClassName="p-0">
            <GroupTable rows={data.groups} totals={t} chargeLabel={chargeLabel} />
          </Section>
          <Section
            title="Per asset"
            description="Assets disposed during the period show the charge up to their disposal date and no closing figures."
            contentClassName="p-0"
          >
            <AssetTable rows={data.assets} chargeLabel={chargeLabel} />
          </Section>
        </>
      ) : (
        <EmptyState
          icon={TrendingDown}
          title="No assets in this period"
          description={`Nothing was held or charged between these dates. Add assets with their useful life on ${register.label} to see their ${kind === "intangible" ? "amortization" : "depreciation"} here.`}
          action={
            can(user, "finance.fixed_assets:create") ? (
              <Button asChild>
                <Link href={`${register.href}?new=1`}>{kind === "intangible" ? "Add an intangible asset" : "Add a fixed asset"}</Link>
              </Button>
            ) : undefined
          }
        />
      )}
    </Page>
  );
}
