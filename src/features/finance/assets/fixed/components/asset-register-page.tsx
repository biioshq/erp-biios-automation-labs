import Link from "next/link";
import { Plus, TrendingDown, Wallet, Layers, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { financialYearIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";
import { labelsFor, type AssetKind } from "../labels";
import { loadAssetPage } from "../page-data";
import { depreciationSummary } from "@/features/finance/assets/depreciation/queries";
import { AssetsView } from "./assets-view";
import { can, requireUser } from "@/server/auth/session";

/** The register page shared by Fixed assets and Intangible assets (server component). */
export async function AssetRegisterPage({ kind, searchParams }: { kind: AssetKind; searchParams: SearchParams }) {
  const labels = labelsFor(kind);
  const user = await requireUser();
  const { register, groups, layout, options } = await loadAssetPage(kind, searchParams);
  const t = register.totals;
  const fy = financialYearIST();
  // Unfiltered, the charge comes from the depreciation summary, which also counts assets disposed
  // and archived this year (the register hides archived ones). Filtered, it is the listed assets'.
  const chargedThisYear = register.filtered
    ? round2(register.rows.reduce((s, r) => s + r.chargedThisYear, 0))
    : (await depreciationSummary(toDateInput(fy.start), toDateInput(new Date()), kind)).totals.charged;
  const suffix = register.filtered ? " (filtered)" : "";

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title={labels.page}
        description={
          kind === "intangible"
            ? "Software, licences and other assets without a physical form, with their amortisation and carrying value."
            : "Furniture, machinery, vehicles, buildings and computers the company owns, with depreciation and book value."
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/finance/assets/depreciation${kind === "intangible" ? "?kind=intangible" : "?kind=tangible"}`}>
                <TrendingDown /> {labels.charge} summary
              </Link>
            </Button>
            {can(user, "finance.fixed_assets:create") ? (
              <Button asChild>
                <Link href="?new=1" scroll={false}>
                  <Plus /> Add {labels.singular}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <StatGrid>
        <StatCard label={`${labels.value} today${suffix}`} value={<Money value={t.bookValue} compact />} icon={Wallet} tone="brand" hint={`${t.count} ${t.count === 1 ? "asset" : "assets"} in the books`} />
        <StatCard label={`Original cost${suffix}`} value={<Money value={t.cost} compact />} icon={Receipt} hint="What was paid, still held" />
        <StatCard label={`${labels.accumulated}${suffix}`} value={<Money value={t.accumulated} compact />} icon={Layers} hint="Charged so far on assets held" />
        <StatCard label={`${labels.charge} in ${fy.label}${suffix}`} value={<Money value={chargedThisYear} compact />} icon={TrendingDown} hint="In the P&L this financial year" />
      </StatGrid>
      <AssetsView kind={kind} register={register} groups={groups} options={options} layout={layout} />
    </Page>
  );
}
