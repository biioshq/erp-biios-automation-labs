import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightLeft, Layers, Plus, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { AdminOnly } from "@/components/shared/admin-only";
import { requireUser } from "@/server/auth/session";
import { round2 } from "@/lib/format";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import { getPanelData, getReserves, listEntries } from "@/features/finance/equity/queries";
import { EquityPanels } from "@/features/finance/equity/components/equity-panels";
import { EntriesTable } from "@/features/finance/equity/components/entries-table";
import { StatLink } from "@/features/finance/equity/components/stat-link";

export const metadata: Metadata = { title: "Reserves & surplus" };

export default async function ReservesPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <AdminOnly title="Reserves & surplus" />;
  const [reserves, transfers, panel] = await Promise.all([getReserves(), listEntries({ types: ["reserve_transfer"] }), getPanelData()]);
  // General reserve includes the reserve types added under it.
  const underGeneral = new Set(["general_reserve"]);
  for (const r of reserves.rows) if (r.parent && underGeneral.has(r.parent)) underGeneral.add(r.key);
  const general = round2(reserves.rows.filter((r) => underGeneral.has(r.key)).reduce((s, r) => s + r.balance, 0));
  const other = round2(reserves.total - general);

  return (
    <Page>
      <PageHeader
        eyebrow="Capital / Equity"
        title="Reserves & surplus"
        description="Profit set aside from retained earnings for a purpose. A transfer to a reserve moves value inside equity: no money leaves the bank and total equity does not change."
        actions={
          <>
            <AddSubgroupButton parents={reserves.parents} defaultParent="reserves_surplus" label="Add reserve type" size="default" />
            <Button asChild>
              <Link href="?new=reserve_transfer" scroll={false}>
                <ArrowRightLeft /> Transfer to reserve
              </Link>
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatLink href="/finance/reports/balance-sheet" label="Total reserves" value={<Money value={reserves.total} />} icon={Vault} tone="brand" hint="As on the balance sheet" />
        <StatCard label="General reserve" value={<Money value={general} />} icon={Vault} hint={underGeneral.size > 1 ? "Including the types under it" : "Built-in group"} />
        <StatCard label="Other reserves" value={<Money value={other} />} icon={Layers} hint="Other reserves and added types" />
        <StatLink href="/finance/equity/retained-earnings" label="Transfers" value={transfers.length} icon={ArrowRightLeft} hint="Moved from retained earnings" />
      </StatGrid>

      <Section title="Reserves" description="Balances today. Add a reserve type (for example a capital redemption reserve) and it is available for transfers straight away." contentClassName="p-0">
        <Table className="min-w-[520px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Reserve</TableHead>
              <TableHead className="text-right">Transfers</TableHead>
              <TableHead className="pr-5 text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reserves.rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="pl-5">
                  <div style={{ paddingLeft: `${r.depth * 1.25}rem` }} className="min-w-0">
                    <p className="font-medium">{r.label}</p>
                    {r.description ? <p className="max-w-md truncate text-xs text-muted-foreground">{r.description}</p> : null}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{r.transfers}</TableCell>
                <TableCell className="pr-5 text-right font-medium">
                  <Money value={r.balance} tone={r.balance < 0 ? "negative" : undefined} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-5 font-semibold" colSpan={2}>
                Total reserves and surplus
              </TableCell>
              <TableCell className="pr-5 text-right font-semibold">
                <Money value={reserves.total} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Section>

      <Section title="Transfers to reserves" description="Each amount set aside from retained earnings, newest first." contentClassName="p-3 sm:p-4">
        <EntriesTable
          id="equity-reserve-transfers"
          entries={transfers}
          show={["reserve", "purpose"]}
          searchPlaceholder="Search reserve, reason, reference…"
          emptyState={
            <EmptyState
              icon={Vault}
              title="No transfers yet"
              description="When the company decides to keep part of its profit in a reserve, record the transfer here."
              action={
                <Button asChild>
                  <Link href="?new=reserve_transfer" scroll={false}>
                    <Plus /> Transfer to reserve
                  </Link>
                </Button>
              }
            />
          }
        />
      </Section>

      <EquityPanels {...panel} defaultNew="reserve_transfer" />
    </Page>
  );
}
