import Link from "next/link";
import { AlertTriangle, CircleX, FolderKanban, History, LineChart, MapPin, Store } from "lucide-react";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { MovementTypeBadge, StockStatusBadge } from "@/components/shared/status-badge";
import { StockLevelBar } from "@/components/shared/stock-level-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INVENTORY_UNITS, WASTAGE_REASONS, labelOf } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { STOCK_STATUS_META } from "@/lib/stock-status";
import { cn } from "@/lib/utils";
import type { ItemDetail, ItemMovementRow } from "../types";
import { ItemActions } from "./item-actions";
import { ItemPhotoPanel } from "./item-photo-panel";
import type { CategoryOption } from "./item-form";
import { PriceTrendChart } from "./price-trend-chart";

function Figure({ label, value, hint, tone, big }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "success" | "warning" | "danger"; big?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "tabular leading-none font-semibold tracking-tight",
          big ? "text-3xl sm:text-4xl" : "text-2xl",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="truncate text-sm font-medium">{children}</div>
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" | "brand" | "info" }) {
  return (
    <div className="rounded-lg border bg-surface/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular text-base font-semibold",
          tone === "success" && "text-success",
          tone === "brand" && "text-brand-ink",
          tone === "info" && "text-info",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatNumber(Math.abs(n))}`;

/** The change a movement made to available stock; a move or project wastage shows its units unsigned. */
const movementQty = (m: ItemMovementRow) => (m.availableDelta === 0 ? formatNumber(m.quantity) : signed(m.availableDelta));

/** What a movement touched besides the stock room: a project, a vendor, a location move. */
function MovementWhere({ m, className }: { m: ItemMovementRow; className?: string }) {
  if (m.relocation) {
    return (
      <span className={cn("min-w-0 truncate text-muted-foreground", className)}>
        {m.relocation.from ?? "No location"} → {m.relocation.to ?? "No location"}
      </span>
    );
  }
  if (m.project) {
    return (
      <Link href={`/finance/projects/${m.project.id}?tab=inventory`} className={cn("flex min-w-0 items-center gap-1.5 hover:underline", className)}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: m.project.color }} />
        <span className="max-w-40 truncate">{m.project.name}</span>
      </Link>
    );
  }
  return <span className={cn("min-w-0 truncate text-muted-foreground", className)}>{m.vendor ?? (m.type === "wastage" ? "Storage" : "Stock room")}</span>;
}

/** Wastage reason and source under the badge, so a write-off reads without opening anything. */
function wastageNote(m: ItemMovementRow) {
  if (!m.wastage) return null;
  return `${labelOf(WASTAGE_REASONS, m.wastage.reason)}, ${m.wastage.from === "project" ? "in use on the project" : "from storage"}`;
}

function OutlookFact({ item }: { item: ItemDetail }) {
  const c = item.coverage;
  const unit = labelOf(INVENTORY_UNITS, item.unit).toLowerCase();
  const today = toDateInput(new Date());
  const late = c.orderBy !== null && c.orderBy <= today;
  return (
    <div className="grid grid-cols-2 gap-4 border-t pt-5 sm:grid-cols-4">
      <Fact label="Lead time">{item.leadTimeDays !== null ? `${formatNumber(item.leadTimeDays)} ${item.leadTimeDays === 1 ? "day" : "days"}` : "Not set"}</Fact>
      <Fact label={`Use per day (last ${c.windowDays} days)`}>
        {c.perDay !== null ? `${formatNumber(Math.round(c.perDay * 100) / 100)} ${unit}` : "No recorded use"}
      </Fact>
      <Fact label="Days of cover">
        {c.daysOfCover !== null ? (
          <span title={c.stockoutDate ? `Runs out around ${formatDate(c.stockoutDate)}` : undefined}>
            {formatNumber(c.daysOfCover)} {c.stockoutDate ? <span className="text-xs font-normal text-muted-foreground">to {formatDate(c.stockoutDate)}</span> : null}
          </span>
        ) : (
          "-"
        )}
      </Fact>
      <Fact label="Order by">
        {c.orderBy ? <span className={cn(late && "text-danger")}>{late ? "Order now" : formatDate(c.orderBy)}</span> : "-"}
      </Fact>
    </div>
  );
}

/** The item page: levels, status callouts, movement history, allocations and purchase prices. */
export function ItemDetailView({
  item,
  categories,
  vendors,
  subcategories = [],
}: {
  item: ItemDetail;
  categories: CategoryOption[];
  vendors: string[];
  subcategories?: string[];
}) {
  const unit = labelOf(INVENTORY_UNITS, item.unit).toLowerCase();
  const tone = item.status === "in_stock" ? "success" : item.status === "low_stock" ? "warning" : "danger";
  const { summary } = item;
  // Units wasted on a project stay in `allocated` (the project bore their cost) but are no longer in use.
  const inUse = Math.max(0, Math.round((item.allocated - item.wastedInUse) * 1000) / 1000);
  const total = Math.round((item.available + inUse) * 1000) / 1000;

  return (
    <Page>
      <PageHeader
        eyebrow="Inventory item"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {item.name}
            <StockStatusBadge status={item.status} className="translate-y-px" />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono text-[13px] text-foreground">{item.sku}</span>
            {item.category ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: item.category.color }} />
                {item.category.name}
                {item.subcategory ? <span className="text-muted-foreground">/ {item.subcategory}</span> : null}
              </span>
            ) : item.subcategory ? (
              <span>{item.subcategory}</span>
            ) : null}
            {item.vendor ? (
              <span className="inline-flex items-center gap-1.5">
                <Store className="size-3.5" /> {item.vendor}
              </span>
            ) : null}
            {item.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" /> {item.location}
              </span>
            ) : null}
          </span>
        }
        actions={<ItemActions item={item} categories={categories} vendors={vendors} subcategories={subcategories} />}
      />

      {item.status === "low_stock" ? (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-warning">Purchase new stock soon</p>
            <p className="text-sm text-muted-foreground">
              {formatNumber(item.available)} {unit} left, at or below the minimum of {formatNumber(item.minStock)}.{" "}
              <Link href={`/inventory/purchase?item=${item.id}`} className="font-medium text-foreground underline underline-offset-4">
                Purchase stock
              </Link>
            </p>
          </div>
        </div>
      ) : null}
      {item.status === "out_of_stock" ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 p-4">
          <CircleX className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-danger">This item must be purchased before it can be allocated</p>
            <p className="text-sm text-muted-foreground">
              Nothing is available, so assigning to projects is disabled.{" "}
              <Link href={`/inventory/purchase?item=${item.id}`} className="font-medium text-foreground underline underline-offset-4">
                Purchase stock
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      <Section contentClassName="space-y-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <ItemPhotoPanel itemId={item.id} name={item.name} photoFileId={item.photoFileId} photoUrl={item.photoUrl} />
          <div className="min-w-0 flex-1 space-y-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:gap-x-6 sm:gap-y-6 xl:grid-cols-4">
              <Figure label="Available" value={formatNumber(item.available)} big tone={tone} hint={unit} />
              <Figure
                label="In use"
                value={formatNumber(inUse)}
                big
                hint={item.wastedInUse > 0 ? `${unit} on projects, ${formatNumber(item.wastedInUse)} more wasted there` : `${unit} on projects`}
              />
              <Figure label="Total" value={formatNumber(total)} big hint={`${unit} in storage and in use`} />
              <Figure label="Minimum" value={formatNumber(item.minStock)} big hint="Low Stock at or below" />
            </div>
            <div className="space-y-2">
              <StockLevelBar available={item.available} minStock={item.minStock} quantity={item.quantity} className="h-2" />
              <p className="text-xs text-muted-foreground">{STOCK_STATUS_META[item.status].description}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t pt-5 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="Unit price (weighted avg)">
            <Money value={item.unitPrice} />
          </Fact>
          <Fact label="Stock value">
            <Money value={item.value} />
          </Fact>
          <Fact label="Last purchase price">{item.lastPurchasePrice !== null ? <Money value={item.lastPurchasePrice} /> : "Not purchased yet"}</Fact>
          <Fact label="Last purchase date">{item.purchaseDate ? formatDate(item.purchaseDate) : "Not purchased yet"}</Fact>
          <Fact label="Added">{formatRelative(item.createdAt)}</Fact>
        </div>
        <OutlookFact item={item} />
        {item.description ? <p className="max-w-3xl text-sm text-pretty text-muted-foreground">{item.description}</p> : null}
        {item.attributes.length ? (
          <dl className="grid max-w-4xl gap-x-6 gap-y-3 border-t pt-5 sm:grid-cols-2" aria-label="Details">
            {item.attributes.map((a) => (
              <div key={a.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{a.label}</dt>
                <dd className="text-sm text-pretty break-words">{a.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Section>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        <Section
          title="Stock movement"
          description={
            summary.count > item.movements.length ? `Latest ${item.movements.length} of ${formatNumber(summary.count)} movements` : "Every change to this item"
          }
          actions={
            <Link href="/inventory/movements" className="inline-flex min-h-8 items-center text-xs font-medium text-muted-foreground hover:text-foreground">
              All movements
            </Link>
          }
          className="lg:col-span-2"
          contentClassName="space-y-4 p-0"
        >
          <div className="grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4 sm:px-5 sm:pt-5 xl:grid-cols-5">
            <SummaryPill label="Purchased" value={formatNumber(summary.purchased)} tone="success" />
            <SummaryPill label="Assigned" value={formatNumber(summary.assigned)} tone="brand" />
            <SummaryPill label="Returned" value={formatNumber(summary.returned)} tone="info" />
            {summary.adjusted !== 0 ? <SummaryPill label="Adjusted" value={signed(summary.adjusted)} /> : null}
            {summary.wasted > 0 ? <SummaryPill label="Wasted" value={formatNumber(summary.wasted)} tone="danger" /> : null}
            <SummaryPill label="Remaining" value={formatNumber(summary.remaining)} />
          </div>
          {item.movements.length === 0 ? (
            <div className="p-4 sm:p-5">
              <EmptyState
                compact
                icon={History}
                title="No movements yet"
                description="Purchases, assignments, returns, wastage, adjustments and location moves appear here."
              />
            </div>
          ) : (
            <>
            <ul className="divide-y border-t md:hidden">
              {item.movements.map((m) => (
                <li key={m.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <MovementTypeBadge type={m.type} />
                    <span
                      className={cn(
                        "tabular text-base font-semibold",
                        m.availableDelta > 0 && "text-success",
                        m.availableDelta < 0 && "text-danger",
                      )}
                    >
                      {movementQty(m)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <MovementWhere m={m} />
                    <span className="tabular shrink-0 text-xs text-muted-foreground">{formatNumber(m.remaining)} left</span>
                  </div>
                  <p className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {formatDate(m.date)}
                      {m.user ? ` · ${m.user}` : ""}
                    </span>
                    {m.unitCost > 0 ? <Money value={m.unitCost} /> : null}
                  </p>
                  {wastageNote(m) ? <p className="text-xs text-danger">{wastageNote(m)}</p> : null}
                  {m.note ? <p className="line-clamp-2 text-xs text-muted-foreground">{m.note}</p> : null}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-10 pl-5 text-xs">Type</TableHead>
                    <TableHead className="h-10 text-right text-xs">Quantity</TableHead>
                    <TableHead className="h-10 text-xs">Project or place</TableHead>
                    <TableHead className="h-10 text-right text-xs">Remaining</TableHead>
                    <TableHead className="h-10 text-right text-xs">Unit cost</TableHead>
                    <TableHead className="h-10 text-xs">Date</TableHead>
                    <TableHead className="h-10 pr-5 text-xs">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="py-2.5 pl-5">
                        <div className="space-y-1">
                          <MovementTypeBadge type={m.type} />
                          {wastageNote(m) ? <p className="max-w-48 truncate text-[11px] text-danger">{wastageNote(m)}</p> : null}
                          {m.note ? <p className="max-w-48 truncate text-[11px] text-muted-foreground" title={m.note}>{m.note}</p> : null}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "tabular py-2.5 text-right font-semibold",
                          m.availableDelta > 0 && "text-success",
                          m.availableDelta < 0 && "text-danger",
                        )}
                      >
                        {movementQty(m)}
                      </TableCell>
                      <TableCell className="py-2.5">
                        <MovementWhere m={m} className="max-w-56" />
                      </TableCell>
                      <TableCell className="tabular py-2.5 text-right">{formatNumber(m.remaining)}</TableCell>
                      <TableCell className="py-2.5 text-right">{m.unitCost > 0 ? <Money value={m.unitCost} /> : <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="py-2.5 whitespace-nowrap text-muted-foreground">{formatDate(m.date)}</TableCell>
                      <TableCell className="max-w-32 truncate py-2.5 pr-5 text-muted-foreground">{m.user ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </Section>

        <div className="flex flex-col gap-6">
          <Section title="In use by project" description="Units projects hold now and can still return">
            {item.allocations.length === 0 ? (
              <EmptyState compact icon={FolderKanban} title="Not assigned to any project" description="Assign stock to a project to see its cost here." />
            ) : (
              <ul className="divide-y">
                {item.allocations.map((a) => (
                  <li key={a.projectId}>
                    <Link
                      href={`/finance/projects/${a.projectId}?tab=inventory`}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{a.name}</span>
                          <span className="block text-xs text-muted-foreground">Last assigned {formatRelative(a.lastAssignedAt)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="tabular block text-sm font-semibold">
                          {formatNumber(a.quantity)} {unit}
                        </span>
                        {a.wasted > 0 ? <span className="tabular block text-xs text-danger">{formatNumber(a.wasted)} wasted</span> : null}
                        <Money value={a.cost} className="text-xs text-muted-foreground" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Purchase history" description="Unit price of each purchase">
            {item.purchases.length === 0 ? (
              <EmptyState compact icon={LineChart} title="No purchases yet" description="Purchase stock to start the price history." />
            ) : (
              <div className="space-y-4">
                {item.purchases.length > 1 ? (
                  <PriceTrendChart points={item.purchases} />
                ) : (
                  <p className="text-sm text-muted-foreground">The price trend appears after a second purchase.</p>
                )}
                <ul className="divide-y text-sm">
                  {[...item.purchases]
                    .reverse()
                    .slice(0, 5)
                    .map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="tabular block">
                            {formatNumber(p.quantity)} {unit}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {formatDate(p.date)}
                            {p.vendor ? ` · ${p.vendor}` : ""}
                          </span>
                        </span>
                        <Money value={p.unitCost} className="font-medium" />
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </Section>
        </div>
      </div>
    </Page>
  );
}
