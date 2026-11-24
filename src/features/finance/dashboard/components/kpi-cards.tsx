import Link from "next/link";
import { ArrowRight, BadgeIndianRupee, Boxes, CalendarClock, FolderKanban, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { ResponsiveMoney } from "./responsive-money";
import { Money } from "@/components/shared/money";
import { StatCard } from "@/components/shared/stat-card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { FinanceDashboardData } from "../types";

export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
      {children} <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
/** "Apr to Oct 2026", "Nov 2025 to Jan 2026", or one month. */
function monthSpan(from: string, to: string) {
  if (from === to) return monthName(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${MONTHS[Number(from.slice(5, 7)) - 1]} to ${monthName(to)}`;
  return `${monthName(from)} to ${monthName(to)}`;
}

/** Tighter tiles on phones so two fit across at 360px. */
export const KPI = "max-sm:p-4 max-sm:[&>.tabular]:text-xl";

/** The six headline numbers. Deltas compare with the previous period up to the same day as today; the monthly average uses whole months. */
export function KpiCards({ data }: { data: FinanceDashboardData }) {
  const k = data.kpis;
  const vs = data.previousPhrase ? `vs ${data.previousPhrase}` : undefined;
  const profitable = k.profit >= 0;
  const avg = k.monthlyAverage;
  const otherProjects = [
    k.planningProjects ? `${formatNumber(k.planningProjects)} planning` : null,
    k.onHoldProjects ? `${formatNumber(k.onHoldProjects)} on hold` : null,
  ].filter(Boolean);

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      <StatCard
        className={KPI}
        label="Total income"
        icon={BadgeIndianRupee}
        tone="success"
        value={<ResponsiveMoney value={k.income} />}
        delta={k.incomeDelta}
        deltaLabel={vs}
        hint={k.incomeDelta === null ? data.periodPhrase : undefined}
        footer={<CardLink href="/finance/income">View income</CardLink>}
      />
      <StatCard
        className={KPI}
        label="Expenses recorded"
        icon={Receipt}
        tone="warning"
        value={<ResponsiveMoney value={k.expenses} />}
        delta={k.expenseDelta}
        deltaLabel={vs}
        invertDelta
        hint={k.expenseDelta === null ? data.periodPhrase : undefined}
        footer={<CardLink href="/finance/expenses">View expenses</CardLink>}
      />
      <StatCard
        className={KPI}
        label="Net profit or loss"
        icon={profitable ? TrendingUp : TrendingDown}
        tone={profitable ? "success" : "danger"}
        value={<ResponsiveMoney value={k.profit} tone={profitable ? undefined : "negative"} />}
        delta={k.profitDelta}
        deltaLabel={vs}
        hint={k.margin === null ? "Income minus expenses recorded. No income in this period" : `Income minus expenses recorded, ${formatPercent(k.margin)} margin`}
        footer={
          data.position ? (
            // The statement books invoices, stock use and depreciation when they happen, so it can differ from the card.
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              Profit in P&amp;L <Money value={data.position.plProfit} tone="auto" className="font-medium text-foreground" />
              <CardLink href={`/finance/reports/profit-loss?${data.position.statementQuery}`}>P&amp;L</CardLink>
            </p>
          ) : undefined
        }
      />
      <StatCard
        className={KPI}
        label="Active projects"
        icon={FolderKanban}
        tone="info"
        value={formatNumber(k.activeProjects)}
        hint={otherProjects.length ? otherProjects.join(" · ") : "None planning or on hold"}
        footer={<CardLink href="/finance/projects">View projects</CardLink>}
      />
      <StatCard
        className={KPI}
        label="Inventory value"
        icon={Boxes}
        tone="brand"
        value={<ResponsiveMoney value={k.inventoryValue} />}
        hint={`Stock on hand across ${formatNumber(k.inventoryItems)} ${k.inventoryItems === 1 ? "item" : "items"}`}
        footer={<CardLink href="/inventory">Open inventory</CardLink>}
      />
      <StatCard
        className={KPI}
        label="Monthly average spending"
        icon={CalendarClock}
        tone="warning"
        value={avg ? <ResponsiveMoney value={avg.value} /> : <span className="text-muted-foreground">Not yet</span>}
        hint={
          avg ? (
            <span title="Expenses of whole calendar months (1st to last day) divided by the number of months. Months with no expenses count as zero.">
              {monthSpan(avg.fromMonth, avg.toMonth)}, {formatNumber(avg.months)} whole {avg.months === 1 ? "month" : "months"}
              {avg.fallback ? (avg.beforeRangeEnd ? " before the range ends" : " before this one") : ""}
            </span>
          ) : (
            "Shows once a whole month of expenses is recorded"
          )
        }
        footer={<p className="text-xs text-muted-foreground">This month so far: {formatCurrency(k.monthToDate)}</p>}
      />
    </div>
  );
}
