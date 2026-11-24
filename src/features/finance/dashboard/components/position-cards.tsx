import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Building2, FolderKanban, Gauge, HandCoins, Landmark, Receipt, Scale, Wallet } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import type { FinanceDashboardData, PositionFigures } from "../types";
import { CardLink, KPI } from "./kpi-cards";
import { ResponsiveMoney } from "./responsive-money";

function GroupHeading({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="-mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * Balance sheet totals and cash movement, for admins. Totals are the balance sheet's own lines
 * (accounting engine), so they match the statements to the paisa.
 */
export function PositionCards({ position, periodLabel }: { position: PositionFigures; periodLabel: string }) {
  const net = position.cashIn - position.cashOut;
  const cashFlowHref = `/finance/reports/cash-flow?${position.statementQuery}`;
  return (
    <section className="space-y-3" aria-label="Financial position">
      <GroupHeading title="Financial position" description={<>Balances on {formatDate(position.asOf)}. Cash in and out: {periodLabel}.</>} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          className={KPI}
          label="Total assets"
          icon={Building2}
          tone="info"
          value={<ResponsiveMoney value={position.totalAssets} />}
          hint="Cash, receivables, stock and fixed assets"
          footer={<CardLink href="/finance/assets">Assets overview</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Total liabilities"
          icon={Scale}
          tone="warning"
          value={<ResponsiveMoney value={position.totalLiabilities} />}
          hint="Supplier bills, loans and other dues"
          footer={<CardLink href="/finance/liabilities">Liabilities</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Total capital / equity"
          icon={Landmark}
          tone="brand"
          value={<ResponsiveMoney value={position.equity} tone={position.equity < 0 ? "negative" : undefined} />}
          hint="Capital, reserves and retained earnings"
          footer={<CardLink href="/finance/equity">Equity summary</CardLink>}
        />
        <StatCard
          className={KPI}
          label={position.asOfToday ? "Current cash position" : "Cash position"}
          icon={Wallet}
          tone="success"
          value={<ResponsiveMoney value={position.cash} tone={position.cash < 0 ? "negative" : undefined} />}
          hint={position.asOfToday ? "Cash in hand and bank balances" : `Cash in hand and bank balances on ${formatDate(position.asOf)}`}
          footer={<CardLink href="/finance/assets/cash">Cash &amp; bank</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Cash inflow"
          icon={ArrowDownLeft}
          tone="success"
          value={<ResponsiveMoney value={position.cashIn} />}
          hint="Money into cash and bank accounts"
          footer={<CardLink href={cashFlowHref}>Cash flow</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Cash outflow"
          icon={ArrowUpRight}
          tone="danger"
          value={<ResponsiveMoney value={position.cashOut} />}
          hint={
            <>
              Net {net >= 0 ? "inflow" : "outflow"} <Money value={Math.abs(net)} compact className="font-medium text-foreground" />
            </>
          }
          footer={<p className="text-xs text-muted-foreground">Transfers between own accounts left out</p>}
        />
      </div>
      {Math.abs(position.difference) >= 0.01 ? (
        <p className="text-xs text-warning">
          The balance sheet is off by <Money value={position.difference} />. Open the{" "}
          <Link href="/finance/reports/trial-balance" className="font-medium underline">
            trial balance
          </Link>{" "}
          to find the entry.
        </p>
      ) : null}
    </section>
  );
}

/** Customer and supplier dues, and the open projects' budget against their spend to date. */
export function OpenItemsCards({ data }: { data: FinanceDashboardData }) {
  const { receivables: rec, payables: pay, projectTotals: pt } = data;
  const usage = pt.utilisation;
  const over = usage !== null && usage > 1;
  return (
    <section className="space-y-3" aria-label="Receivables, payables and projects">
      <GroupHeading title="Dues and projects" description="As of today. Project figures are to date, for planning, active and on hold projects." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5">
        <StatCard
          className={KPI}
          label="Outstanding receivables"
          icon={HandCoins}
          tone="success"
          value={<Money value={rec.total} compact />}
          hint={rec.overdue > 0 ? <span className="text-danger"><Money value={rec.overdue} compact /> overdue</span> : `${formatNumber(rec.count)} open ${rec.count === 1 ? "invoice" : "invoices"}`}
          footer={<CardLink href="/finance/invoices">Invoices</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Outstanding payables"
          icon={Receipt}
          tone="warning"
          value={<Money value={pay.total} compact />}
          hint={pay.overdue > 0 ? <span className="text-danger"><Money value={pay.overdue} compact /> overdue</span> : `${formatNumber(pay.count)} unpaid ${pay.count === 1 ? "bill" : "bills"}`}
          footer={<CardLink href="/finance/payments">Payments</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Total project budget"
          icon={FolderKanban}
          tone="info"
          value={<Money value={pt.budget} compact />}
          hint={`${formatNumber(pt.count)} open ${pt.count === 1 ? "project" : "projects"}`}
          footer={<CardLink href="/finance/projects/budgets">Budget tracking</CardLink>}
        />
        <StatCard
          className={KPI}
          label="Actual project expenditure"
          icon={Receipt}
          tone="brand"
          value={<Money value={pt.spent} compact />}
          hint="Spent to date on those projects"
          footer={<SalariesHiddenNote />}
        />
        <StatCard
          className={cn(KPI, "max-sm:col-span-2")}
          label="Overall budget utilisation"
          icon={Gauge}
          tone={over ? "danger" : usage !== null && usage >= 0.8 ? "warning" : "success"}
          value={usage === null ? <span className="text-muted-foreground">No budget</span> : formatPercent(usage)}
          hint={usage === null ? "No open project has a budget" : over ? "Spend is above the combined budget" : "Spent of the combined budget"}
          footer={
            usage !== null ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(usage * 100))}>
                <div className={cn("h-full rounded-full", over ? "bg-danger" : usage >= 0.8 ? "bg-warning" : "bg-chart-1")} style={{ width: `${Math.min(100, usage * 100)}%` }} />
              </div>
            ) : (
              <CardLink href="/finance/projects">Projects</CardLink>
            )
          }
        />
      </div>
    </section>
  );
}
