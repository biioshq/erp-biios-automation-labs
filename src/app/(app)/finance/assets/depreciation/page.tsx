import type { Metadata } from "next";
import Link from "next/link";
import { Armchair, KeyRound, Layers, Receipt, TrendingDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { requireUser } from "@/server/auth/session";
import { formatDate } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { SearchParams } from "@/lib/list-params";
import { parseDepreciationPeriod, parseKind } from "@/features/finance/assets/depreciation/period";
import { depreciationSummary } from "@/features/finance/assets/depreciation/queries";
import { PeriodControls } from "@/features/finance/assets/depreciation/components/period-controls";
import { AssetTable, GroupTable } from "@/features/finance/assets/depreciation/components/depreciation-tables";

export const metadata: Metadata = { title: "Depreciation summary" };

const CHARGE_LABEL = { all: "Charged in period", tangible: "Depreciation in period", intangible: "Amortisation in period" } as const;

export default async function DepreciationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const sp = await searchParams;
  const period = parseDepreciationPeriod(sp);
  const kind = parseKind(sp.kind);
  const data = await depreciationSummary(period.from, period.to, kind);
  const t = data.totals;
  const range = `${formatDate(fromDateInput(period.from))} to ${formatDate(fromDateInput(period.to))}`;
  const periodText = period.mode === "fy" ? `${period.label}${period.toToday ? ", up to today" : ""}` : range;
  const chargeLabel = CHARGE_LABEL[kind];
  const both = kind === "all";
  const midMonth = period.mode === "custom" && !period.from.endsWith("-01");

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Depreciation summary"
        description="Depreciation of fixed assets and amortisation of intangible assets, per group and per asset. Figures use the same calculation as the balance sheet and the profit and loss."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/finance/assets/fixed">
                <Armchair /> Fixed assets
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/finance/assets/intangible">
                <KeyRound /> Intangible assets
              </Link>
            </Button>
          </>
        }
      />
      <PeriodControls period={period} years={data.years} kind={kind} />
      <p className="-mt-3 text-xs text-muted-foreground">
        {periodText}. Cost, accumulated and book value are as at {formatDate(fromDateInput(period.to))}, for assets still held that day.
        {midMonth
          ? " This period starts inside a month: the charge here counts only its days, while the profit and loss books a whole month's charge on the month's last day, so the two can differ."
          : ""}
      </p>

      <StatGrid>
        <StatCard label={chargeLabel} value={<Money value={t.charged} compact />} icon={TrendingDown} tone="brand" hint={both ? "Charged to the P&L in the period" : periodText} />
        <StatCard label="Original cost" value={<Money value={t.cost} compact />} icon={Receipt} hint={`${t.count} ${t.count === 1 ? "asset" : "assets"} held`} />
        <StatCard label="Accumulated" value={<Money value={t.accumulated} compact />} icon={Layers} hint="Charged from purchase to the end of the period" />
        <StatCard label="Book value" value={<Money value={t.bookValue} compact />} icon={Wallet} hint="Cost less accumulated" />
      </StatGrid>

      {both && (data.byKind.intangible.count > 0 || data.byKind.intangible.charged > 0) ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["tangible", "intangible"] as const).map((k) => (
            <div key={k} className="rounded-xl border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{k === "tangible" ? "Depreciation of fixed assets" : "Amortisation of intangible assets"}</p>
              <Money value={data.byKind[k].charged} className="mt-0.5 block text-lg font-semibold" />
              <p className="text-xs text-muted-foreground">
                Book value <Money value={data.byKind[k].bookValue} /> · {data.byKind[k].count} held
              </p>
            </div>
          ))}
        </div>
      ) : null}

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
          description="Nothing was held or charged between these dates. Add assets with their useful life on the Fixed assets or Intangible assets page to see their depreciation here."
          action={
            <Button asChild>
              <Link href="/finance/assets/fixed?new=1">Add a fixed asset</Link>
            </Button>
          }
        />
      )}
    </Page>
  );
}
