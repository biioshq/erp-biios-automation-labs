import "server-only";

import { DEFAULT_WINDOW_DAYS, lookAheadAlerts } from "@/server/analytics/core";
import { endOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { SEASONAL_MIN_MONTHS } from "../constants";
import type { DemandRow, ShortageRow } from "../types";
import { firstAssignment, monthlyMovements, monthsBetween } from "./history";

/**
 * Shortage risks are the shared stock alerts (the same list as Inventory > Low stock): out of
 * stock, at or under the minimum, or running out within lead time plus a week at the standard
 * 90-day rate. They are narrowed to the items the page shows.
 */
export async function shortageRisks(rows: DemandRow[], now: Date = new Date()): Promise<ShortageRow[]> {
  const shown = new Map(rows.map((r) => [r.id, r]));
  const alerts = await lookAheadAlerts(now, DEFAULT_WINDOW_DAYS);
  return alerts
    .filter((a) => shown.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      sku: a.sku,
      unit: a.unit,
      available: a.available,
      minStock: a.minStock,
      level: a.level,
      reasons: a.reasons,
      stockoutDate: a.stockoutDate,
      orderBy: a.orderBy,
      suggestedQty: a.suggestedQty,
      // The alert's run-out date rests on a rate the history rule would not forecast from.
      limitedHistory: a.level === "runs_out" && shown.get(a.id)?.status !== "forecast",
    }));
}

export type SeasonalPattern =
  | { enough: false; firstUse: string | null; months: number }
  | {
      enough: true;
      firstUse: string;
      months: number;
      /** Average value of stock used in each calendar month, April first (the financial year). */
      pattern: { month: number; label: string; average: number; years: number }[];
    };

const FY_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const MONTH_LABEL = (m: number) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));

/**
 * A seasonal pattern only when stock has been used for at least 12 months: the average value
 * used in each calendar month over every complete month on record (up to three years).
 */
export async function seasonalPattern(itemIds: string[] | null, now: Date = new Date()): Promise<SeasonalPattern> {
  const first = await firstAssignment({ itemIds });
  const months = first ? monthsBetween(first, now) : 0;
  if (!first || months < SEASONAL_MIN_MONTHS) return { enough: false, firstUse: first ? toDateInput(first) : null, months };
  // Complete months only: the current month is still running.
  const from = startOfMonthIST(now, -Math.min(months, 36));
  const to = endOfDayIST(new Date(startOfMonthIST(now).getTime() - 1));
  const series = await monthlyMovements(from, to, { itemIds });
  const pattern = FY_ORDER.map((m) => {
    const values = series.filter((p) => Number(p.month.slice(5)) === m && p.month >= toDateInput(first).slice(0, 7)).map((p) => p.consumedValue);
    return {
      month: m,
      label: MONTH_LABEL(m),
      average: values.length ? round2(values.reduce((s, v) => s + v, 0) / values.length) : 0,
      years: values.length,
    };
  });
  return { enough: true, firstUse: toDateInput(first), months, pattern };
}
