import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpFromLine, FolderKanban, PackagePlus, Trash2, Warehouse } from "lucide-react";
import { Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StockPeriodKey, StockPosition } from "../types";

function StatLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </Link>
  );
}

/** Stock in storage, in use on projects, and wasted. */
export function StockSplit({ position }: { position: StockPosition }) {
  const { storage, inUse, wasted } = position;
  return (
    <StatGrid className="xl:grid-cols-3">
      <StatLink href="/finance/assets/inventory">
        <StatCard
          label="Stock in storage"
          icon={Warehouse}
          tone="brand"
          className="h-full"
          value={<Money value={storage.value} compact />}
          hint="In the stock room, at weighted average cost"
        />
      </StatLink>
      <StatLink href="/finance/assets/inventory">
        <StatCard
          label="Stock in use"
          icon={FolderKanban}
          tone="info"
          className="h-full"
          value={<Money value={inUse.value} compact />}
          hint={`${formatNumber(inUse.units)} units on projects, at the cost they were assigned at`}
        />
      </StatLink>
      <StatLink href="/inventory/wastage">
        <StatCard
          label={`Wasted, ${wasted.fyLabel}`}
          icon={Trash2}
          tone="danger"
          className="h-full"
          value={<Money value={wasted.financialYear.value} compact />}
          hint={
            <>
              <Money value={wasted.allTime.value} compact /> all time, {formatNumber(wasted.allTime.count)} write-offs
            </>
          }
        />
      </StatLink>
    </StatGrid>
  );
}

/**
 * One line of the roll-forward, with the sign of its effect on stock. `value` is as stored: lines
 * marked `out` (issued, wasted) hold positive amounts that reduce stock. Balances show no "+".
 */
function Line({ label, value, out, strong, hint }: { label: string; value: number; out?: boolean; strong?: boolean; hint?: string }) {
  const effect = out ? -value : value;
  const prefix = effect < 0 ? "-" : effect > 0 && !strong ? "+" : "";
  return (
    <div className={cn("flex items-baseline justify-between gap-3 px-4 py-2.5 sm:px-5", strong && "bg-surface/50")}>
      <div className="min-w-0">
        <p className={cn("text-sm", strong ? "font-semibold" : "text-muted-foreground")}>{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <span className={cn("tabular shrink-0 text-sm whitespace-nowrap", strong ? "font-semibold" : "font-medium")}>
        {prefix}
        <Money value={Math.abs(effect)} />
      </span>
    </div>
  );
}

/** Opening stock, what came in and went out, and closing stock for a period, from the books. */
export function StockRollForwardSection({ position, periods }: { position: StockPosition; periods: { value: StockPeriodKey; label: string }[] }) {
  const r = position.roll;
  return (
    <Section
      title="Stock in storage over the period"
      description={`${formatDate(r.from)} to ${formatDate(r.to)}, at cost, from the books' Inventory account`}
      contentClassName="p-0"
      actions={
        <Link href="/finance/assets/inventory" className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
          Full tables <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      <nav aria-label="Period" className="flex gap-1.5 overflow-x-auto border-b px-4 py-3 sm:flex-wrap sm:px-5">
        {periods.map((p) => {
          const active = p.value === position.period;
          return (
            <Link
              key={p.value}
              href={p.value === "fy" ? "/inventory" : `/inventory?period=${p.value}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs transition-colors max-md:h-9",
                active ? "border-brand/40 bg-brand/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      <div className="divide-y">
        <Line label="Opening stock" value={r.opening} strong />
        <Line label="Purchases" value={r.purchased} hint="Stock cost of purchases, without GST input credit" />
        {r.enteredOnHand !== 0 ? <Line label="Entered as already on hand" value={r.enteredOnHand} hint="Opening stock added to new items" /> : null}
        <Line label="Issued to projects" value={r.issued} out />
        <Line label="Returned from projects" value={r.returned} />
        <Line label="Wasted from storage" value={r.wasted} out hint="Wastage on projects left storage when it was issued" />
        {r.adjusted !== 0 ? <Line label="Count adjustments" value={r.adjusted} /> : null}
        {r.other !== 0 ? <Line label="Other" value={r.other} /> : null}
        <Line label="Closing stock" value={r.closing} strong />
      </div>
      <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">
        Moves between projects show as both issued and returned, at the same cost, so they cancel out.
      </p>
    </Section>
  );
}

const OPERATIONS = [
  { href: "/inventory/purchase", title: "Stock in", text: "Purchase stock into storage", icon: PackagePlus, tone: "text-success bg-success/10" },
  { href: "/inventory/assign", title: "Stock out", text: "Issue stock to a project", icon: ArrowUpFromLine, tone: "text-brand-ink bg-brand/10" },
  { href: "/inventory/transfer", title: "Stock transfer", text: "Project to project, or a new location", icon: ArrowLeftRight, tone: "text-info bg-info/10" },
  { href: "/inventory/return", title: "Stock return", text: "Take unused stock back from a project", icon: ArrowDownToLine, tone: "text-info bg-info/10" },
  { href: "/inventory/wastage", title: "Record wastage", text: "Damaged, expired, lost or scrap", icon: Trash2, tone: "text-danger bg-danger/10" },
] as const;

/** The five stock operations, one tap each. */
export function StockOperations() {
  return (
    <Section title="Stock operations" description="Every change to stock goes through one of these">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {OPERATIONS.map((op) => (
          <li key={op.href}>
            <Link
              href={op.href}
              className="group flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", op.tone)}>
                <op.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{op.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{op.text}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
