import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpFromLine, CalendarDays, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { AdminOnly } from "@/components/shared/admin-only";
import { requireUser } from "@/server/auth/session";
import { equityOverview } from "@/server/finance/summaries";
import { financialYearIST } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import { getPanelData, listEntries } from "@/features/finance/equity/queries";
import { EquityPanels } from "@/features/finance/equity/components/equity-panels";
import { EntriesTable } from "@/features/finance/equity/components/entries-table";
import { StatLink } from "@/features/finance/equity/components/stat-link";

export const metadata: Metadata = { title: "Drawings" };

export default async function DrawingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Drawings" />;
  const [overview, drawings, panel] = await Promise.all([equityOverview(), listEntries({ types: ["drawing"] }), getPanelData()]);
  const fy = financialYearIST();
  const thisYear = drawings.filter((d) => new Date(d.date).getTime() >= fy.start.getTime());
  const yearTotal = round2(thisYear.reduce((s, d) => s + d.amount, 0));
  const owners = new Set(drawings.map((d) => d.holder?.id).filter(Boolean)).size;

  return (
    <Page>
      <PageHeader
        eyebrow="Capital / Equity"
        title="Drawings"
        description="Money owners took out of the business for personal use. A drawing reduces the owner's capital balance. It is not an expense and does not change profit."
        actions={
          <Button asChild>
            <Link href="?new=drawing" scroll={false}>
              <Plus /> Record drawing
            </Link>
          </Button>
        }
      />

      <StatGrid>
        <StatLink href="/finance/reports/balance-sheet" label="Total drawings" value={<Money value={Math.abs(overview.drawings)} />} icon={ArrowUpFromLine} tone="warning" hint="As on the balance sheet" />
        <StatCard label={`Drawings in ${fy.label}`} value={<Money value={yearTotal} />} icon={CalendarDays} hint={`${thisYear.length} ${thisYear.length === 1 ? "withdrawal" : "withdrawals"}`} />
        <StatLink href="/finance/equity/owners" label="Owners who drew" value={owners} icon={UserRound} hint="See each owner's balance" />
        <StatCard label="Last drawing" value={drawings[0] ? formatDate(drawings[0].date) : "None"} icon={CalendarDays} hint={drawings[0]?.holder?.name ?? "Nothing recorded yet"} />
      </StatGrid>

      <Section title="All drawings" description="Owner, withdrawal date, amount, purpose and payment mode. Click a row for the full record." contentClassName="p-3 sm:p-4">
        <EntriesTable
          id="equity-drawings"
          entries={drawings}
          show={["holder", "purpose", "payment"]}
          searchPlaceholder="Search owner, purpose, reference…"
          emptyState={
            <EmptyState
              icon={ArrowUpFromLine}
              title="No drawings recorded"
              description="Record each withdrawal an owner makes, with its purpose and how it was paid."
              action={
                <Button asChild>
                  <Link href="?new=drawing" scroll={false}>
                    <Plus /> Record drawing
                  </Link>
                </Button>
              }
            />
          }
        />
      </Section>

      <EquityPanels {...panel} defaultNew="drawing" defaultKind="owner" />
    </Page>
  );
}
