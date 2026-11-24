import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpFromLine,
  Boxes,
  Info,
  PackageOpen,
  PackagePlus,
  Trash2,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectStatusBadge, StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SearchParams } from "@/lib/list-params";
import { requireUser } from "@/server/auth/session";
import { getInventoryValuation } from "@/features/finance/assets/inventory/queries";
import { StockTables } from "@/features/finance/assets/inventory/components/stock-tables";
import { PeriodItemsTable, PeriodPicker } from "@/features/finance/assets/inventory/components/period-items-table";
import type { AlertRow, Flow } from "@/features/finance/assets/inventory/types";

export const metadata: Metadata = { title: "Inventory valuation" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const isDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const units = (n: number) => `${formatNumber(n)} ${n === 1 ? "unit" : "units"}`;

const LEVEL: Record<AlertRow["level"], { label: string; tone: "danger" | "warning" | "info" }> = {
  out: { label: "Out of stock", tone: "danger" },
  below_min: { label: "Below minimum", tone: "warning" },
  runs_out: { label: "Runs out soon", tone: "info" },
};

function FlowRow({ label, sign, flow, strong, hint }: { label: string; sign?: "+" | "-" | "±"; flow: Flow; strong?: boolean; hint?: string }) {
  return (
    <tr className={cn("border-b last:border-0", strong && "bg-muted/40 font-semibold")}>
      <td className="py-2.5 pr-3 pl-3 sm:pl-4">
        <span className="flex items-baseline gap-2">
          <span className="w-3 shrink-0 text-center text-muted-foreground">{sign ?? ""}</span>
          <span>
            {label}
            {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
          </span>
        </span>
      </td>
      <td className="tabular py-2.5 pr-3 text-right whitespace-nowrap">{formatNumber(flow.quantity)}</td>
      <td className="py-2.5 pr-3 text-right sm:pr-4">
        <Money value={flow.value} tone={flow.value < 0 ? "auto" : undefined} />
      </td>
    </tr>
  );
}

export default async function InventoryValuationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const params = await searchParams;
  const data = await getInventoryValuation(isDay(one(params.from)), isDay(one(params.to)));
  const { storage, inUse, wasted, period, alerts } = data;
  const held = storage.value + inUse.value;
  const bookGap = Math.round((data.bookValue - storage.value) * 100) / 100;
  const empty = storage.items === 0 && inUse.rows.length === 0 && wasted.rows.length === 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Finance · Assets"
        title="Inventory valuation"
        description="Stock as an asset: what is in storage, what is in use on projects and what was wasted. Valued at weighted average cost. Stock is entered and moved on the Inventory pages; this page only reads it."
        actions={
          <>
            <Button asChild>
              <Link href="/inventory/purchase">
                <PackagePlus /> Stock in
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/inventory/assign">
                <ArrowUpFromLine /> Stock out
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/inventory/transfer">
                <ArrowLeftRight /> Transfer
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/inventory/return">
                <ArrowDownToLine /> Return
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/inventory/wastage">
                <Trash2 /> Record wastage
              </Link>
            </Button>
          </>
        }
      />

      {alerts.length ? (
        <Link
          href="/inventory/low-stock"
          role="status"
          className="group flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3.5 transition-colors hover:bg-warning/15 sm:items-center"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
            <AlertTriangle className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-warning">
              {formatNumber(alerts.length)} {alerts.length === 1 ? "item needs" : "items need"} ordering
            </span>
            <span className="block text-xs text-muted-foreground">
              {alerts.filter((a) => a.level === "out").length} out of stock, {alerts.filter((a) => a.level === "below_min").length} at or below the minimum,{" "}
              {alerts.filter((a) => a.level === "runs_out").length} running out within their lead time plus a week. Open Low stock.
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-warning transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      {empty ? (
        <EmptyState
          icon={Boxes}
          title="No stock recorded yet"
          description="Add items and record purchases in Inventory. Their value, use on projects and wastage then show here."
          action={
            <Button asChild>
              <Link href="/inventory/purchase">
                <PackagePlus /> Stock in
              </Link>
            </Button>
          }
        />
      ) : null}

      <StatGrid>
        <StatCard label="Total inventory" value={<Money value={held} />} icon={Boxes} tone="brand" hint={`${units(storage.quantity + inUse.quantity)} in storage and in use`} />
        <StatCard label="Stock in storage" value={<Money value={storage.value} />} icon={Warehouse} tone="success" hint={`${units(storage.quantity)}, ${formatNumber(storage.rows.length)} items`} />
        <StatCard label="Stock in use" value={<Money value={inUse.value} />} icon={PackageOpen} tone="info" hint={`${units(inUse.quantity)} on ${formatNumber(inUse.projects.length)} projects`} />
        <StatCard
          label="Wasted stock"
          value={<Money value={wasted.value} />}
          icon={Trash2}
          tone="danger"
          hint={
            <>
              {units(wasted.quantity)} all time · <Money value={wasted.yearValue} /> in {wasted.yearLabel}
            </>
          }
        />
      </StatGrid>

      <div className="flex flex-col gap-2 rounded-xl border bg-surface/40 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-start sm:gap-3">
        <Info className="size-4 shrink-0 text-info" />
        <p className="text-pretty">
          Valuation method: weighted average cost. Stock in storage is each item&apos;s available units times its average cost per unit. Stock in use is
          valued at the cost it was issued at and is already charged to its project, so the balance sheet counts only stock in storage
          {Math.abs(bookGap) >= 1 ? (
            <>
              {" "}
              (<Money value={data.bookValue} /> in the books, <Money value={Math.abs(bookGap)} /> {bookGap > 0 ? "more" : "less"} than the item values: the
              books value each stock movement at its recorded cost, while item values use today&apos;s average cost)
            </>
          ) : null}
          . Quantities add units of every kind (pieces, metres, kilograms) together, so read them as counts.
        </p>
      </div>

      <Section
        title="Stock for the period"
        description={`${formatDate(fromDateInput(period.from))} to ${formatDate(fromDateInput(period.to))}, stock in storage. Opening stock is the closing stock of the day before.`}
        actions={<PeriodPicker from={period.from} to={period.to} />}
        contentClassName="space-y-4"
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 pl-3 text-left font-medium sm:pl-4">In storage</th>
                <th className="py-2 pr-3 text-right font-medium">Units</th>
                <th className="py-2 pr-3 text-right font-medium sm:pr-4">Value</th>
              </tr>
            </thead>
            <tbody>
              <FlowRow label="Opening stock" flow={period.opening} strong />
              <FlowRow label="Purchases" sign="+" flow={period.purchases} hint="Stock bought, and stock entered as already on hand" />
              <FlowRow label="Issued to projects" sign="-" flow={period.issued} />
              <FlowRow label="Returned from projects" sign="+" flow={period.returned} />
              <FlowRow label="Wastage from storage" sign="-" flow={period.wastage} />
              <FlowRow label="Count adjustments" sign="±" flow={period.adjustments} />
              <FlowRow label="Closing stock" flow={period.closing} strong />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Values are the Inventory account in the books, so opening and closing stock match the balance sheet on those days.
          {period.wastedInUse.quantity > 0 ? (
            <>
              {" "}
              Also wasted while in use on projects: {units(period.wastedInUse.quantity)} worth <Money value={period.wastedInUse.value} />, already charged to
              those projects, so storage did not change.
            </>
          ) : null}
          {period.movedBetweenProjects.quantity > 0 ? (
            <>
              {" "}
              Moved straight from one project to another: {units(period.movedBetweenProjects.quantity)} worth{" "}
              <Money value={period.movedBetweenProjects.value} />, not counted as issued or returned because it never came back to storage.
            </>
          ) : null}{" "}
          {formatNumber(period.movementCount)} stock movements in the period.{" "}
          <Link href="/inventory/movements" className="font-medium text-brand-ink hover:underline">
            All movements
          </Link>
        </p>
        <PeriodItemsTable rows={data.periodItems} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <Section title="Stock in use by project" description="Units still on each project, less wasted, at the cost they were issued at" contentClassName="px-4 py-2 sm:px-5">
          {inUse.projects.length ? (
            <ul className="divide-y">
              {inUse.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    {p.id !== "none" ? (
                      <Link href={`/finance/projects/${p.id}`} className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
                        {p.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{p.name}</span>
                    )}
                    <p className="text-xs text-muted-foreground">{formatNumber(p.lines)} {p.lines === 1 ? "assignment" : "assignments"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="max-sm:hidden">
                      <ProjectStatusBadge status={p.status} />
                    </span>
                    <Money value={p.value} className="font-semibold" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={PackageOpen} title="No stock on projects" description="Assign stock to a project and it shows here until it is returned or used up." />
          )}
        </Section>

        <Section
          title="Low stock and early alerts"
          description="Out of stock, at or below the minimum level, or running out within the lead time plus a week at the recent rate of use"
          actions={
            <Link href="/inventory/low-stock" className="text-xs font-medium text-brand-ink hover:underline">
              Low stock
            </Link>
          }
          contentClassName="px-4 py-2 sm:px-5"
        >
          {alerts.length ? (
            <ul className="divide-y">
              {alerts.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/inventory/items/${a.id}`} className="block truncate text-sm font-medium hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(a.available)} available, minimum {formatNumber(a.minStock)}
                      {a.orderBy ? ` · order by ${formatDate(fromDateInput(a.orderBy))}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{a.reasons.join(". ")}</p>
                  </div>
                  <StatusBadge tone={LEVEL[a.level].tone}>{LEVEL[a.level].label}</StatusBadge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={AlertTriangle} title="Nothing to reorder" description="No item is out of stock, at its minimum, or expected to run out within its lead time plus a week." />
          )}
          {alerts.length > 8 ? (
            <Link href="/inventory/low-stock" className="mt-1 block py-2 text-xs font-medium text-brand-ink hover:underline">
              {formatNumber(alerts.length - 8)} more on Low stock
            </Link>
          ) : null}
        </Section>
      </div>

      <Section title="Stock details" description="Every item in storage, every open assignment and every wastage record" contentClassName="p-3 sm:p-4">
        <StockTables storage={storage.rows} inUse={inUse.rows} wasted={wasted.rows} />
        {storage.outOfStock > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {formatNumber(storage.outOfStock)} {storage.outOfStock === 1 ? "item has" : "items have"} nothing in storage and {storage.outOfStock === 1 ? "is" : "are"} not
            listed.{" "}
            <Link href="/inventory/items?status=out_of_stock" className="font-medium text-brand-ink hover:underline">
              Out of stock items
            </Link>
          </p>
        ) : null}
      </Section>
    </Page>
  );
}
