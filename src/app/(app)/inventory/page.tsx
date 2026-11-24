import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, CircleCheck, CircleX, IndianRupee, PackagePlus, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { MovementTypeBadge, StockStatusBadge } from "@/components/shared/status-badge";
import { StockLevelBar } from "@/components/shared/stock-level-bar";
import { INVENTORY_UNITS, labelOf } from "@/lib/constants";
import { formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getInventoryDashboard } from "@/features/inventory/dashboard/queries";
import { STOCK_PERIODS, getStockPosition } from "@/features/inventory/dashboard/stock-position";
import { StockOperations, StockRollForwardSection, StockSplit } from "@/features/inventory/dashboard/components/stock-position";
import type { StockPeriodKey } from "@/features/inventory/dashboard/types";
import { CategoryValueChart, MovementTrendChart, StockHealthChart } from "@/features/inventory/dashboard/components/dashboard-charts";
import { can, requireUser } from "@/server/auth/session";
import { NoAccess } from "@/components/shared/no-access";

export const metadata: Metadata = { title: "Inventory" };

function StatLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {children}
    </Link>
  );
}

export default async function InventoryDashboardPage({ searchParams }: PageProps<"/inventory">) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  const user = await requireUser();
  if (!can(user, "inventory.dashboard:view")) return <NoAccess eyebrow="Inventory" title="Inventory dashboard" />;
  const sp = await searchParams;
  const raw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period: StockPeriodKey = STOCK_PERIODS.find((p) => p.value === raw)?.value ?? "fy";
  const [{ snapshot, valueByCategory, weekly, attention, attentionTotal, attentionLevels, recent }, position] = await Promise.all([
    getInventoryDashboard(),
    getStockPosition(period),
  ]);
  const restock = attentionTotal;
  // From the reorder list itself, so the parts add up to the total above them.
  const breakdown = [
    attentionLevels.out ? `${formatNumber(attentionLevels.out)} out of stock` : null,
    attentionLevels.belowMin ? `${formatNumber(attentionLevels.belowMin)} at or below minimum` : null,
    attentionLevels.runsOut ? `${formatNumber(attentionLevels.runsOut)} running out within lead time plus a week` : null,
  ].filter(Boolean);
  const share = (n: number) => (snapshot.items ? `${Math.round((n / snapshot.items) * 100)}% of items` : "No items yet");

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory"
        title="Inventory dashboard"
        description="Stock levels, value and movement across every item. Status colours match the lists and item pages."
        actions={
          <>
            {can(user, "inventory.items:create") ? (
              <Button variant="outline" asChild>
                <Link href="/inventory/items?new=1">
                  <Plus /> Add item
                </Link>
              </Button>
            ) : null}
            {can(user, "inventory.purchase:create") ? (
              <Button asChild>
                <Link href="/inventory/purchase">
                  <PackagePlus /> Purchase stock
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {restock > 0 ? (
        <Link
          href="/inventory/low-stock"
          role="status"
          className="animate-in fade-in-0 group flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3.5 sm:items-center transition-colors hover:bg-warning/15"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning">
            <AlertTriangle className="size-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-warning">
              {formatNumber(restock)} {restock === 1 ? "item needs" : "items need"} restocking
            </span>
            <span className="block text-xs text-muted-foreground">
              {breakdown.join(", ")}. Open the restock list.
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-warning transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      <StatGrid className="xl:grid-cols-5">
        <StatLink href="/inventory/items">
          <StatCard label="Total inventory items" value={formatNumber(snapshot.items)} icon={Boxes} tone="info" hint="Active items" className="h-full" />
        </StatLink>
        <StatLink href="/inventory/items?status=in_stock">
          <StatCard label="In Stock" value={formatNumber(snapshot.inStock)} icon={CircleCheck} tone="success" hint={share(snapshot.inStock)} className="h-full" />
        </StatLink>
        <StatLink href="/inventory/items?status=low_stock">
          <StatCard label="Low Stock" value={formatNumber(snapshot.lowStock)} icon={AlertTriangle} tone="warning" hint={share(snapshot.lowStock)} className="h-full" />
        </StatLink>
        <StatLink href="/inventory/items?status=out_of_stock">
          <StatCard label="Out of Stock" value={formatNumber(snapshot.outOfStock)} icon={CircleX} tone="danger" hint={share(snapshot.outOfStock)} className="h-full" />
        </StatLink>
        <StatCard
          label="Total inventory value"
          value={<Money value={snapshot.value} compact />}
          icon={IndianRupee}
          tone="brand"
          hint="In storage, at weighted average cost"
        />
      </StatGrid>

      <StockSplit position={position} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <StockRollForwardSection position={position} periods={STOCK_PERIODS} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <StockOperations can={(p) => can(user, p)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Section title="Stock health" description="Items by status" className="animate-in fade-in-0 duration-500">
          <StockHealthChart snapshot={snapshot} />
        </Section>
        <Section
          title="Inventory value by category"
          description="Available stock at weighted average cost"
          className="animate-in fade-in-0 duration-500 lg:col-span-2"
        >
          <CategoryValueChart categories={valueByCategory} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Section
          title="Stock movement"
          description="Units per week, last 30 days. A move between projects counts as one return and one assignment."
          className="animate-in fade-in-0 duration-500 lg:col-span-2"
          actions={
            <Link href="/inventory/movements" className="inline-flex min-h-8 items-center text-xs font-medium text-muted-foreground hover:text-foreground">
              View all
            </Link>
          }
        >
          <MovementTrendChart weeks={weekly} />
        </Section>

        <Section
          title="Needs attention"
          description="Low, out of stock, or running out soon"
          contentClassName="p-2"
          className="animate-in fade-in-0 duration-500"
          actions={
            attentionTotal > attention.length ? (
              <Link href="/inventory/low-stock" className="inline-flex min-h-8 items-center text-xs font-medium text-muted-foreground hover:text-foreground">
                All {formatNumber(attentionTotal)}
              </Link>
            ) : undefined
          }
        >
          {attention.length === 0 ? (
            <div className="p-3">
              <EmptyState compact icon={CircleCheck} title="Everything is stocked" description="No item is at or below its minimum or running out within its lead time plus a week." />
            </div>
          ) : (
            <ul className="divide-y">
              {attention.map((item) => (
                <li key={item.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 w-full flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <Link href={`/inventory/items/${item.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                        {item.name}
                      </Link>
                      <StockStatusBadge status={item.status} />
                    </div>
                    <StockLevelBar available={item.available} minStock={item.minStock} quantity={item.quantity} />
                    <p className="tabular text-xs text-muted-foreground">
                      <span className={cn("font-medium", item.status === "out_of_stock" ? "text-danger" : "text-warning")}>
                        {formatNumber(item.available)}
                      </span>{" "}
                      available, minimum {formatNumber(item.minStock)} {labelOf(INVENTORY_UNITS, item.unit).toLowerCase()}
                    </p>
                    {item.reason ? <p className="text-xs text-muted-foreground">{item.reason}</p> : null}
                  </div>
                  {can(user, "inventory.purchase:create") ? (
                    <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                      <Link href={`/inventory/purchase?item=${item.id}`}>
                        <ShoppingCart /> Purchase
                      </Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Recent movements"
        description="The latest eight changes to stock"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/inventory/movements">
              All movements <ArrowRight />
            </Link>
          </Button>
        }
        contentClassName="p-2"
        className="animate-in fade-in-0 duration-500"
      >
        {recent.length === 0 ? (
          <div className="p-3">
            <EmptyState compact icon={PackagePlus} title="No movements yet" description="Add an item with opening stock or purchase stock to start the history." />
          </div>
        ) : (
          <ul className="divide-y">
            {recent.map((m) => {
              const gain = m.availableDelta > 0;
              // A location move or wastage on a project leaves storage unchanged: show its units unsigned.
              const still = m.availableDelta === 0;
              return (
                <li key={m.id}>
                  <Link
                    href="/inventory/movements"
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{m.item?.name ?? "Deleted item"}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{m.item?.sku}</span>
                    </span>
                    <span className="justify-self-end sm:justify-self-start">
                      <MovementTypeBadge type={m.type} />
                    </span>
                    <span className="hidden min-w-0 items-center gap-1.5 truncate text-sm text-muted-foreground sm:flex">
                      {m.project ? (
                        <>
                          <span className="size-2 shrink-0 rounded-full" style={{ background: m.project.color }} />
                          <span className="truncate">{m.project.name}</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </span>
                    <span className="text-right">
                      <span className={cn("tabular block text-sm font-semibold", still ? "text-muted-foreground" : gain ? "text-success" : "text-danger")}>
                        {still ? formatNumber(m.quantity) : `${gain ? "+" : "-"}${formatNumber(Math.abs(m.availableDelta))}`}
                      </span>
                      <span className="block text-xs text-muted-foreground">{formatRelative(m.date)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Page>
  );
}
