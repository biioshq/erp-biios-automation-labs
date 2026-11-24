import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Money } from "@/components/shared/money";
import { ResponsiveMoney } from "@/features/finance/dashboard/components/responsive-money";
import { Section } from "@/components/shared/page";
import { SalariesHiddenNote } from "@/components/shared/salaries-hidden-note";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/lib/format";
import { SPEND_TYPES } from "../finance";
import type { ProjectFinanceRow } from "../types";

function Figure({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg leading-tight font-semibold tracking-tight">{children}</dd>
      {hint ? <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Spend split into materials, labour, equipment, transportation and other, as bars. */
export function SpendByTypeList({ project }: { project: ProjectFinanceRow }) {
  const { byType, spent } = project.finance;
  if (spent <= 0) return <p className="text-sm text-muted-foreground">No expenses recorded for this project yet.</p>;
  return (
    <ul className="space-y-2.5">
      {SPEND_TYPES.map((t) => {
        const value = byType[t.key];
        const share = spent > 0 ? value / spent : 0;
        return (
          <li key={t.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{t.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <Money value={value} className="font-medium" />
                <span className="tabular w-10 text-right text-xs text-muted-foreground">{formatPercent(share)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-chart-1" style={{ width: `${share * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The project's money in one place: what it earns, what was received and is still owed, what it
 * spent by type, and the profit and budget variance worked out the same way as on the
 * Profitability and Budget tracking pages.
 */
export function ProjectFinances({ project }: { project: ProjectFinanceRow }) {
  const r = project.finance.revenue;
  const o = project.outlook;
  return (
    <Section
      title="Finances"
      description="Revenue is invoices raised plus payments received without an invoice. Spend comes from the project's expenses."
      actions={
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <Link href="/finance/projects/profitability" className="inline-flex items-center gap-1 text-brand-ink hover:underline">
            Profitability <ArrowRight className="size-3" aria-hidden />
          </Link>
          <Link href="/finance/projects/budgets" className="inline-flex items-center gap-1 text-brand-ink hover:underline">
            Budget tracking <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:col-span-3">
          <Figure
            label="Total project value"
            hint={project.contractValue === null ? "Not recorded. Add it with Edit." : "Agreed with the client"}
          >
            {project.contractValue === null ? <span className="text-muted-foreground">Not set</span> : <ResponsiveMoney value={project.contractValue} />}
          </Figure>
          <Figure label="Revenue" hint={`${formatNumber(r.invoiceCount)} ${r.invoiceCount === 1 ? "invoice" : "invoices"}, ${r.receivedDirect > 0 ? "plus direct receipts" : "no direct receipts"}`}>
            <ResponsiveMoney value={r.revenue} />
          </Figure>
          <Figure label="Payments received" hint={r.receivedDirect > 0 ? <>incl. <Money value={r.receivedDirect} /> without an invoice</> : "Against invoices"}>
            <ResponsiveMoney value={r.received} />
          </Figure>
          <Figure label="Outstanding receivables" hint={r.overdue > 0 ? <span className="text-danger"><Money value={r.overdue} /> overdue</span> : "Nothing overdue"}>
            <ResponsiveMoney value={r.outstanding} />
          </Figure>
          <Figure label="Total spent" hint={`${formatNumber(project.finance.expenseCount)} ${project.finance.expenseCount === 1 ? "expense" : "expenses"}`}>
            <ResponsiveMoney value={project.finance.spent} />
          </Figure>
          <Figure
            label="Estimated profit"
            hint={
              <>
                {o.valueBasis === "contract" ? "Project value" : "Revenue so far"} minus expected final cost
                {o.margin !== null ? `, ${formatPercent(o.margin)} margin` : ""}
              </>
            }
          >
            <ResponsiveMoney value={o.estimatedProfit} tone="auto" />
          </Figure>
          <Figure label="Expected final cost" hint={o.closed ? "Closed: spent so far" : "Spent plus the unspent budget"}>
            <ResponsiveMoney value={o.expectedFinalCost} />
          </Figure>
          <Figure label="Budget variance" hint={project.budget > 0 ? (o.remainingBudget < 0 ? "Over the revised budget" : "Under the revised budget") : "No budget set"}>
            {project.budget > 0 ? <ResponsiveMoney value={o.remainingBudget} tone="auto" /> : <span className="text-muted-foreground">-</span>}
          </Figure>
          <Figure label="Budget" hint={o.budgetRevision !== 0 ? <>Original <Money value={project.originalBudget} /></> : "Never revised"}>
            <ResponsiveMoney value={project.budget} />
          </Figure>
        </dl>
        <div className="space-y-3 lg:col-span-2">
          <p className="eyebrow text-[10px]">Spend by type</p>
          <SpendByTypeList project={project} />
          <SalariesHiddenNote />
        </div>
      </div>
    </Section>
  );
}
