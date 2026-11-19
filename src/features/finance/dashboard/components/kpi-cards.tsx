import Link from "next/link";
import { ArrowRight, BadgeIndianRupee, Boxes, CalendarClock, FolderKanban, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { ResponsiveMoney } from "./responsive-money";
import { StatCard } from "@/components/shared/stat-card";
import { formatNumber, formatPercent } from "@/lib/format";
import type { FinanceDashboardData } from "../types";

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
      {children} <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

/** Tighter tiles on phones so two fit across at 360px. */
const KPI = "max-sm:p-4 max-sm:[&>.tabular]:text-xl";

/** The six headline numbers. Deltas compare with the previous period up to the same day as today. */
export function KpiCards({ data }: { data: FinanceDashboardData }) {
  const k = data.kpis;
  const vs = data.previousPhrase ? `vs ${data.previousPhrase}` : undefined;
  const profitable = k.profit >= 0;
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
        label="Total expenses"
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
        label="Profit"
        icon={profitable ? TrendingUp : TrendingDown}
        tone={profitable ? "success" : "danger"}
        value={<ResponsiveMoney value={k.profit} tone={profitable ? undefined : "negative"} />}
        delta={k.profitDelta}
        deltaLabel={vs}
        hint={k.margin === null ? "No income in this period" : `${formatPercent(k.margin)} margin`}
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
        label="Monthly spending"
        icon={CalendarClock}
        tone="warning"
        value={<ResponsiveMoney value={k.monthSpend} />}
        delta={k.monthSpendDelta}
        deltaLabel="vs same days last month"
        invertDelta
        hint={k.monthSpendDelta === null ? "Spent this calendar month" : undefined}
      />
    </div>
  );
}
