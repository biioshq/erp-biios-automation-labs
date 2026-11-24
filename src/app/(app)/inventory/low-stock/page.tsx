import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CircleCheck, CircleX, Info, TrendingDown, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatNumber } from "@/lib/format";
import { toDateInput } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getLowStockItems } from "@/features/inventory/low-stock/queries";
import { LowStockList } from "@/features/inventory/low-stock/components/low-stock-list";
import type { AlertLevel } from "@/features/inventory/low-stock/types";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Low stock" };

const VIEWS = [
  { value: "all", label: "All" },
  { value: "out", label: "Out of stock" },
  { value: "low", label: "At or below minimum" },
  { value: "soon", label: "Runs out soon" },
] as const;
type View = (typeof VIEWS)[number]["value"];
const LEVEL_OF: Record<Exclude<View, "all">, AlertLevel> = { out: "out", low: "below_min", soon: "runs_out" };

export default async function LowStockPage({ searchParams }: PageProps<"/inventory/low-stock">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const view: View = VIEWS.find((v) => v.value === raw)?.value ?? "all";
  const { items, summary } = await getLowStockItems();
  const shown = view === "all" ? items : items.filter((i) => i.level === LEVEL_OF[view]);
  const count = (v: View) => (v === "all" ? items.length : v === "out" ? summary.out : v === "low" ? summary.belowMin : summary.runsOut);

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Low stock"
        description="Items to reorder now, including those that will run out before a new order could arrive. Out of stock first, then the soonest to run out."
      />

      <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5 text-sm shadow-card">
        <Info className="mt-0.5 size-4 shrink-0 text-info" />
        <p className="text-muted-foreground">
          An item is listed when it is out of stock, at or below its minimum, or when its stock runs out within its lead time plus {summary.bufferDays} days at
          the rate it was used over the last {summary.windowDays} days (units issued to projects less units returned). Order by is the last day to order so the
          stock arrives in time. Items with no recorded use have no rate, so only the minimum applies to them. The team gets one in-app alert per item a week
          while it stays on this list. Set each item&apos;s lead time on its edit form.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-dashed px-4 py-12 text-center sm:px-6 sm:py-16">
          <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] opacity-60" />
          <div className="relative flex size-12 items-center justify-center rounded-2xl border border-success/30 bg-success/10 shadow-card">
            <CircleCheck className="size-6 text-success" />
          </div>
          <div className="relative max-w-sm space-y-1">
            <p className="text-sm font-semibold">All stock is healthy</p>
            <p className="text-sm text-muted-foreground">
              No item is at its minimum, and none runs out within its lead time plus a week at the recent rate of use.
            </p>
          </div>
          <Button asChild variant="outline" className="relative mt-1">
            <Link href="/inventory/items">View all items</Link>
          </Button>
        </div>
      ) : (
        <>
          <StatGrid>
            <StatCard label="Out of stock" icon={CircleX} tone="danger" value={formatNumber(summary.out)} hint="Cannot be assigned to projects" />
            <StatCard label="At or below minimum" icon={TriangleAlert} tone="warning" value={formatNumber(summary.belowMin)} hint="Below the level set on the item" />
            <StatCard
              label="Runs out soon"
              icon={TrendingDown}
              tone="info"
              value={formatNumber(summary.runsOut)}
              hint={`Within lead time plus ${summary.bufferDays} days`}
            />
            <StatCard
              label="Suggested orders, at cost"
              icon={CalendarClock}
              tone="brand"
              value={<Money value={summary.estimatedCost} compact />}
              hint={`Every suggested quantity at its last purchase price. ${formatNumber(summary.orderNow)} ${summary.orderNow === 1 ? "item is" : "items are"} due to order today.`}
            />
          </StatGrid>

          <nav aria-label="Filter by reason" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {VIEWS.map((v) => {
              const active = view === v.value;
              return (
                <Link
                  key={v.value}
                  href={v.value === "all" ? "/inventory/low-stock" : `/inventory/low-stock?status=${v.value}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors max-md:h-10",
                    active ? "border-brand/40 bg-brand/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {v.label}
                  <span className="tabular text-xs text-muted-foreground">{count(v.value)}</span>
                </Link>
              );
            })}
          </nav>

          {shown.length > 0 ? (
            <LowStockList items={shown} today={toDateInput(new Date())} />
          ) : (
            <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">Nothing in this view.</p>
          )}
        </>
      )}
    </Page>
  );
}
