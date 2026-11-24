import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, Boxes, CalendarClock, IndianRupee, PackagePlus, Search, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/shared/page";
import { StatCard, StatGrid } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { HORIZONS, MIN_HISTORY_DAYS, MIN_MOVEMENTS } from "@/features/analytics/forecasting/constants";
import { parseFilters, parseHorizon, resolveWindow, type SearchParams } from "@/features/analytics/forecasting/params";
import { purchasePlan } from "@/features/analytics/forecasting/server/purchases";
import { filterOptions } from "@/features/analytics/forecasting/server/options";
import { ForecastFilters } from "@/features/analytics/forecasting/components/forecast-filters";
import { ParamToggle } from "@/features/analytics/forecasting/components/param-toggle";
import { PurchaseTable } from "@/features/analytics/forecasting/components/purchase-table";
import { MethodNote, NotRecorded } from "@/features/analytics/forecasting/components/notes";
import { plural } from "@/features/analytics/forecasting/utils";

export const metadata: Metadata = { title: "Purchase requirements" };

type Props = { searchParams: Promise<SearchParams> };

const VIEWS = [
  { value: "buy", label: "To buy" },
  { value: "all", label: "All materials" },
];

export default async function PurchaseRequirementsPage({ searchParams }: Props) {
  // Every page checks the session itself: client navigations can skip the layout's check.
  await requireUser();
  const sp = await searchParams;
  const window = resolveWindow(sp);
  const filters = parseFilters(sp);
  const horizon = parseHorizon(sp);
  const view = sp.view === "all" ? "all" : "buy";
  const [plan, options] = await Promise.all([purchasePlan(window, filters, horizon), filterOptions()]);
  const shown = view === "all" ? plan.rows : plan.rows.filter((r) => r.suggestedQty > 0);

  return (
    <Page>
      <PageHeader
        eyebrow="Analytics & Planning"
        title="Purchase requirements"
        description="What to buy and by when, from the recent rate of use, lead times and minimum levels. These are recommendations: nothing is ordered or added to stock from this page."
        actions={
          <Button asChild>
            <Link href="/inventory/purchase">
              <PackagePlus /> Record a purchase
            </Link>
          </Button>
        }
      />
      <ForecastFilters materials={options.materials} categories={options.categories} projects={options.projects} window={window} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Cover</span>
          <ParamToggle
            param="horizon"
            label="Days to cover"
            defaultValue="30"
            value={String(horizon)}
            options={HORIZONS.map((h) => ({ value: String(h), label: `${h} days` }))}
          />
        </div>
        <ParamToggle param="view" label="Materials shown" value={view} options={VIEWS} />
      </div>

      {plan.totalItems === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No inventory items yet"
          description="Purchase requirements start once items are added and stock is assigned to projects."
          action={
            <Button asChild>
              <Link href="/inventory/items">Go to items</Link>
            </Button>
          }
        />
      ) : plan.rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No materials match these filters"
          description="Clear a filter to see purchase requirements."
          action={
            <Button asChild variant="outline">
              <Link href="/analytics/forecasting/purchases">Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Materials to buy" icon={ShoppingCart} tone="brand" value={formatNumber(plan.toBuy)} hint={`Covering ${horizon} days plus lead time`} />
            <StatCard
              label="Estimated purchase cost"
              icon={IndianRupee}
              tone="info"
              value={<Money value={plan.estimatedCost} compact />}
              hint={plan.unpriced ? `${plural(plan.unpriced, "material")} without a price left out` : "At the last purchase price, else average cost"}
            />
            <StatCard label="Order today" icon={AlarmClock} tone={plan.orderNow ? "danger" : "success"} value={formatNumber(plan.orderNow)} hint="The order-by date has come or passed" />
            <StatCard label="Order within 7 days" icon={CalendarClock} tone={plan.orderThisWeek ? "warning" : "default"} value={formatNumber(plan.orderThisWeek)} hint="Order-by date this week" />
          </StatGrid>

          <MethodNote>
            <p>
              <span className="font-medium text-foreground">How this is worked out.</span> Needed = average daily use × ({horizon} days + the item&apos;s lead time). Suggested
              purchase = needed + minimum level − available, never below zero. Order by = the day stock runs out less the lead time, or today when that day has passed. Average use
              is the use from {formatDate(fromDateInput(window.from))} to {formatDate(fromDateInput(window.to))}, divided by the days from the material&apos;s first assignment
              in that window to its end (at least {MIN_HISTORY_DAYS}), so a material first used partway through is not spread over days before it was used.
            </p>
            <p>
              Materials without enough history (fewer than {MIN_MOVEMENTS} assignments or returns in the window, or under {MIN_HISTORY_DAYS} days recorded) get no forecast; if they are below
              their minimum level, the suggestion only brings them back to it. The Low stock page covers lead time plus one week instead of a chosen horizon, so its quantities
              can differ.
              {filters.project
                ? " With a project picked, use, use counts and history are that project's own, while available stock is the company's whole stock, which other projects draw on too."
                : ""}
              {plan.noLeadTime ? ` ${plural(plan.noLeadTime, "material")} to buy ${plan.noLeadTime === 1 ? "has" : "have"} no lead time set, counted as 0 days; set it on the item.` : ""}
            </p>
          </MethodNote>

          <div className="grid gap-3 md:grid-cols-2">
            <NotRecorded title="Pending purchase quantity">Purchase orders are not recorded, so suggestions assume nothing is on order. Check open orders before buying.</NotRecorded>
            <NotRecorded title="Expected incoming stock">Vendor delivery dates are not recorded. Lead times come from each item&apos;s setting.</NotRecorded>
          </div>

          <Section
            title={view === "all" ? "All materials" : "Suggested purchases"}
            description={view === "all" ? "Every material in the filters, with or without a suggestion." : "Materials with a suggested purchase, earliest order date first."}
          >
            {shown.length ? (
              <PurchaseTable rows={shown} horizon={horizon} />
            ) : (
              <EmptyState
                compact
                icon={Boxes}
                title="Nothing to buy for this horizon"
                description="Every material has enough stock for its expected use and minimum level, or too little history to forecast."
              />
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
