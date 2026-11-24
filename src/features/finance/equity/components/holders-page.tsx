import Link from "next/link";
import { ArrowUpFromLine, Landmark, PieChart, Plus, UserPlus, UserRound, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IfCan } from "@/features/finance/equity/components/if-can";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { round2 } from "@/lib/format";
import type { EquityHolderKind } from "@/lib/constants";
import { equityOverview } from "@/server/finance/summaries";
import { getHolders, getPanelData, listEntries } from "../queries";
import { EquityPanels } from "./equity-panels";
import { HoldersTable } from "./holders-table";
import { EntriesTable } from "./entries-table";
import { StatLink } from "./stat-link";

const COPY = {
  owner: {
    title: "Owners' capital",
    description: "Capital each owner introduced, what they took out as drawings, and their current capital balance.",
    add: "Add owner",
    emptyTitle: "No owners added yet",
    emptyText: "Add each owner as a separate record, then record the initial capital they introduced and any additional capital later.",
  },
  investor: {
    title: "Investors' capital",
    description: "Money each investor put in, the investment type and their ownership share where it applies.",
    add: "Add investor",
    emptyTitle: "No investors added yet",
    emptyText: "Add each investor as a separate record, then record their initial investment and any later contributions.",
  },
} as const;

/** The owners page and the investors page: the same layout for one role each. */
export async function HoldersPage({ kind }: { kind: EquityHolderKind }) {
  const copy = COPY[kind];
  const [overview, holders, entries, panel] = await Promise.all([
    equityOverview(),
    getHolders(kind),
    listEntries({ holderKind: kind, types: kind === "owner" ? ["capital", "drawing"] : ["capital", "dividend"] }),
    getPanelData(),
  ]);
  const active = holders.filter((h) => !h.archived);
  const capital = kind === "owner" ? overview.ownersCapital : overview.investorsCapital;
  // The balance sheet line, so this page and the statements always agree.
  const drawings = Math.abs(overview.drawings);
  const ownership = round2(active.reduce((s, h) => s + (h.ownershipPercent ?? 0), 0));
  const withShare = active.filter((h) => h.ownershipPercent !== null).length;

  return (
    <Page>
      <PageHeader
        eyebrow="Capital / Equity"
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <IfCan permission="finance.equity:create">
              <Button asChild variant="outline">
                <Link href={`?holder=new&kind=${kind}`} scroll={false}>
                  <UserPlus /> {copy.add}
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

      <StatGrid>
        <StatLink
          href="/finance/reports/balance-sheet"
          label={kind === "owner" ? "Total owner's capital" : "Total investors' capital"}
          value={<Money value={capital} />}
          icon={Landmark}
          tone="brand"
          hint="As on the balance sheet"
        />
        {kind === "owner" ? (
          <>
            <StatLink href="/finance/equity/drawings" label="Drawings" value={<Money value={drawings} />} icon={ArrowUpFromLine} tone="warning" hint="Taken out by owners" />
            <StatCard label="Current capital balance" value={<Money value={round2(capital - drawings)} tone="auto" />} icon={Wallet} tone="success" hint="Capital less drawings" />
          </>
        ) : (
          <>
            <StatCard label="Contributions" value={entries.filter((e) => e.type === "capital").length} icon={Wallet} hint="Capital entries recorded" />
            <StatCard
              label="Ownership held"
              value={withShare ? `${ownership}%` : "Not set"}
              icon={PieChart}
              tone="info"
              hint={withShare ? `By ${withShare} ${withShare === 1 ? "investor" : "investors"} with a share set` : "Set a share on each investor where it applies"}
            />
          </>
        )}
        <StatCard
          label={kind === "owner" ? "Owners" : "Investors"}
          value={active.length}
          icon={kind === "owner" ? UserRound : Users}
          hint={holders.length > active.length ? `${holders.length - active.length} archived` : "Active records"}
        />
      </StatGrid>

      <Section
        title={kind === "owner" ? "Owners" : "Investors"}
        description="Click a name to see every contribution, edit their details or record more capital."
        contentClassName="p-3 sm:p-4"
      >
        <HoldersTable
          id={`equity-${kind}s`}
          holders={holders}
          mode={kind}
          emptyState={
            <EmptyState
              icon={kind === "owner" ? UserRound : Users}
              title={copy.emptyTitle}
              description={copy.emptyText}
              action={
                <IfCan permission="finance.equity:create">
                  <Button asChild>
                    <Link href={`?holder=new&kind=${kind}`} scroll={false}>
                      <UserPlus /> {copy.add}
                    </Link>
                  </Button>
                </IfCan>
              }
            />
          }
        />
      </Section>

      <Section
        title={kind === "owner" ? "Capital and drawings" : "Contributions"}
        description={kind === "owner" ? "Every capital entry and drawing of the owners, newest first." : "Every investment and dividend of the investors, newest first."}
        contentClassName="p-3 sm:p-4"
      >
        <EntriesTable
          id={`equity-${kind}-entries`}
          entries={entries}
          show={["holder", "payment"]}
          emptyState={
            <EmptyState
              compact
              icon={Landmark}
              title="Nothing recorded yet"
              description={kind === "owner" ? "Capital introduced and drawings show here once recorded." : "Investments show here once recorded."}
            />
          }
        />
      </Section>

      <EquityPanels {...panel} defaultNew="capital" defaultKind={kind} />
    </Page>
  );
}
