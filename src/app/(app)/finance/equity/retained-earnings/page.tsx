import type { Metadata } from "next";
import Link from "next/link";
import { BadgeIndianRupee, History, Plus, TriangleAlert, TrendingUp, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IfCan } from "@/features/finance/equity/components/if-can";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { NoAccess } from "@/components/shared/no-access";
import { can, requireUser } from "@/server/auth/session";
import { formatCurrency } from "@/lib/format";
import { getPanelData, getRetainedEarnings } from "@/features/finance/equity/queries";
import { EquityPanels } from "@/features/finance/equity/components/equity-panels";
import { EntriesTable } from "@/features/finance/equity/components/entries-table";
import { StatLink } from "@/features/finance/equity/components/stat-link";

export const metadata: Metadata = { title: "Retained earnings" };

/** A deduction shown as "less", or a dash when there is none. */
function Less({ value }: { value: number }) {
  return value ? <Money value={-value} tone="negative" /> : <span className="text-muted-foreground">0</span>;
}

export default async function RetainedEarningsPage() {
  const user = await requireUser();
  if (!can(user, "finance.equity:view")) return <NoAccess title="Retained earnings" />;
  const [data, panel] = await Promise.all([getRetainedEarnings(), getPanelData()]);
  const opening = data.entries.filter((e) => e.type === "opening_retained");
  const beforeBooksNote = data.beforeBooks
    ? "Opening figure entered below"
    : opening.length
      ? "The figures below are dated after the first record, so they count as adjustments in their year"
      : "No opening figure entered";

  return (
    <Page>
      <PageHeader
        eyebrow="Capital / Equity"
        title="Retained earnings"
        description="Profit the business has kept: what it had before the books started, plus each financial year's profit or loss, less dividends paid and amounts moved to reserves."
        actions={
          <>
            <IfCan permission="finance.equity:create">
              <Button asChild variant="outline">
                <Link href="/finance/equity/reserves?new=reserve_transfer" scroll={false}>
                  <Vault /> Transfer to reserve
                </Link>
              </Button>
            </IfCan>
            <IfCan permission="finance.equity:create">
              <Button asChild>
                <Link href="?new=dividend" scroll={false}>
                  <Plus /> Record dividend
                </Link>
              </Button>
            </IfCan>
          </>
        }
      />

      <StatGrid>
        <StatLink
          href="/finance/reports/balance-sheet"
          label="Accumulated retained earnings"
          value={<Money value={data.balance} tone="auto" />}
          icon={TrendingUp}
          tone={data.balance < 0 ? "danger" : "success"}
          hint="As on the balance sheet"
        />
        <StatCard label="From earlier years" value={<Money value={data.earlierYears} tone="auto" />} icon={History} hint={`Before ${data.currentYearLabel}`} />
        <StatLink
          href="/finance/reports/profit-loss"
          label={`Profit or loss, ${data.currentYearLabel}`}
          value={<Money value={data.currentYear} tone="auto" />}
          icon={TrendingUp}
          tone={data.currentYear < 0 ? "danger" : "default"}
          hint="This financial year to date"
        />
        <StatCard label="Dividends distributed" value={<Money value={data.dividends} />} icon={BadgeIndianRupee} hint={data.toReserves ? `All time · ${formatCurrency(data.toReserves)} moved to reserves` : "All time"} />
      </StatGrid>

      <Section title="Year by year" description="Each year's profit or loss comes from the profit and loss statement. The last closing figure is the balance sheet line." contentClassName="p-0">
        {data.years.length || data.beforeBooks ? (
          <>
            <Table className="sm:min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3 whitespace-normal sm:pl-5">Financial year</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Opening</TableHead>
                  <TableHead className="text-right">Profit or loss</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Adjustments</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Dividends</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">To reserves</TableHead>
                  <TableHead className="pr-3 text-right sm:pr-5">Closing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.years.map((y) => (
                  <TableRow key={y.label}>
                    <TableCell className="pl-3 sm:pl-5">
                      <Link href={`/finance/reports/profit-loss?from=${y.from}&to=${y.to}`} className="font-medium hover:underline">
                        {y.label}
                      </Link>
                      {y.current ? <span className="block text-xs text-muted-foreground sm:ml-2 sm:inline">to date</span> : null}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Money value={y.opening} tone="auto" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={y.profit} tone="auto" />
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{y.adjustments ? <Money value={y.adjustments} tone="auto" /> : <span className="text-muted-foreground">0</span>}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Less value={y.dividends} />
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Less value={y.toReserves} />
                    </TableCell>
                    <TableCell className="pr-3 text-right font-semibold sm:pr-5">
                      <Money value={y.closing} tone="auto" />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="pl-3 whitespace-normal text-muted-foreground sm:pl-5">Before the books started</TableCell>
                  <TableCell colSpan={5} className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                    {beforeBooksNote}
                  </TableCell>
                  <TableCell className="text-right text-xs whitespace-normal text-muted-foreground sm:hidden">{beforeBooksNote}</TableCell>
                  <TableCell className="pr-3 text-right font-semibold sm:pr-5">
                    <Money value={data.beforeBooks} tone="auto" />
                  </TableCell>
                </TableRow>
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-3 font-semibold whitespace-normal sm:pl-5" colSpan={2}>
                    Retained earnings on the balance sheet
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" colSpan={4} />
                  <TableCell className="pr-3 text-right font-semibold sm:pr-5">
                    <Money value={data.balance} tone="auto" />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {Math.abs(data.difference) >= 0.01 ? (
              <p className="flex items-start gap-2 border-t px-5 py-3 text-xs text-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                The years add up to <Money value={data.balance + data.difference} /> but the balance sheet shows <Money value={data.balance} />. The balance sheet figure is the one used everywhere.
              </p>
            ) : null}
          </>
        ) : (
          <div className="p-4 sm:p-5">
            <EmptyState
              compact
              icon={TrendingUp}
              title="No profit or loss recorded yet"
              description="Once income or expenses are recorded, each financial year's result shows here."
            />
          </div>
        )}
      </Section>

      <Section
        title="Retained earnings before the books started"
        description="The accumulated profit (or loss) from the last balance sheet before this ERP, dated the day before the first records here. Enter a loss as a negative amount."
        actions={
          <IfCan permission="finance.equity:create">
            <Button asChild size="sm" variant={opening.length ? "outline" : "default"}>
              <Link href="?new=opening_retained" scroll={false}>
                <Plus /> {opening.length ? "Add a correction" : "Enter opening figure"}
              </Link>
            </Button>
          </IfCan>
        }
        contentClassName="p-3 sm:p-4"
      >
        <EntriesTable
          id="equity-opening-retained"
          entries={opening}
          show={[]}
          hideToolbar
          emptyState={
            <EmptyState
              compact
              icon={History}
              title="No opening figure entered"
              description="If the company made profits or losses before it started using this ERP, enter that figure so retained earnings match the last audited balance sheet."
            />
          }
        />
      </Section>

      <Section title="Dividends and transfers to reserves" description="Profit paid out or set aside. Neither is an expense." contentClassName="p-3 sm:p-4">
        <EntriesTable
          id="equity-retained-entries"
          entries={data.entries.filter((e) => e.type !== "opening_retained")}
          show={["holder", "reserve", "payment"]}
          emptyState={
            <EmptyState
              compact
              icon={BadgeIndianRupee}
              title="No dividends or reserve transfers"
              description="Record a dividend when profit is paid out, or move part of it to a reserve."
            />
          }
        />
      </Section>

      <EquityPanels {...panel} defaultNew="dividend" openingDate={data.openingDate} />
    </Page>
  );
}
