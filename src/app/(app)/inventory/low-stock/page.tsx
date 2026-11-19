import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleX, IndianRupee, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { Money } from "@/components/shared/money";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getLowStockItems } from "@/features/inventory/low-stock/queries";
import { LowStockList } from "@/features/inventory/low-stock/components/low-stock-list";

export const metadata: Metadata = { title: "Low Stock" };

const VIEWS = [
  { value: "all", label: "All" },
  { value: "out", label: "Out of stock" },
  { value: "low", label: "Low stock" },
] as const;

export default async function LowStockPage({ searchParams }: PageProps<"/inventory/low-stock">) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const view = VIEWS.some((v) => v.value === raw) ? (raw as (typeof VIEWS)[number]["value"]) : "all";
  const { items, summary } = await getLowStockItems();
  const shown = items.filter((i) => view === "all" || (view === "out" ? i.status === "out_of_stock" : i.status === "low_stock"));

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Low stock"
        description="Items at or below their minimum level, emptiest first. Suggested orders bring each item back to twice its minimum."
      />

      {items.length === 0 ? (
        <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-dashed px-4 py-12 text-center sm:px-6 sm:py-16">
          <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] opacity-60" />
          <div className="relative flex size-12 items-center justify-center rounded-2xl border border-success/30 bg-success/10 shadow-card">
            <CircleCheck className="size-6 text-success" />
          </div>
          <div className="relative max-w-sm space-y-1">
            <p className="text-sm font-semibold">All stock is healthy</p>
            <p className="text-sm text-muted-foreground">Every item is above its minimum level. Items that fall to their minimum show up here with a suggested order.</p>
          </div>
          <Button asChild variant="outline" className="relative mt-1">
            <Link href="/inventory/items">View all inventory</Link>
          </Button>
        </div>
      ) : (
        <>
          <StatGrid className="xl:grid-cols-3">
            <StatCard label="Low stock" icon={TriangleAlert} tone="warning" value={formatNumber(summary.low)} hint="At or below the minimum level" />
            <StatCard label="Out of stock" icon={CircleX} tone="danger" value={formatNumber(summary.out)} hint="Cannot be assigned to projects" />
            <StatCard
              label="Estimated restock cost"
              icon={IndianRupee}
              tone="brand"
              value={<Money value={summary.estimatedCost} compact />}
              hint={<Money value={summary.estimatedCost} exact />}
            />
          </StatGrid>

          <nav aria-label="Filter by status" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {VIEWS.map((v) => {
              const count = v.value === "all" ? items.length : v.value === "out" ? summary.out : summary.low;
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
                  <span className="tabular text-xs text-muted-foreground">{count}</span>
                </Link>
              );
            })}
          </nav>

          {shown.length > 0 ? (
            <LowStockList items={shown} />
          ) : (
            <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">Nothing in this view.</p>
          )}
        </>
      )}
    </Page>
  );
}
