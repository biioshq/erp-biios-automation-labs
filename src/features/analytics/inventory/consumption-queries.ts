import "server-only";

import { usageByItem } from "@/server/analytics/core";
import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { previousRange, type AnalyticsRange } from "./params";
import { itemNames, loadMovements, projectNames, round3, type MovementFact } from "./data";

/**
 * Consumption trends (4.5). Consumption is the shared measure: stock issued to projects less
 * stock returned (src/server/analytics/core.ts usageByItem gives the units). Values are the cost
 * recorded on those movements. Wastage is not consumption and is left out.
 *
 * Unusual patterns, two stated rules:
 *  - a material whose use this period is at least double, or at most half, its use in the
 *    previous period of the same length (both periods must have some use for "half"; a material
 *    used now and not before is listed as new);
 *  - a day, week or month whose consumption value is more than twice the average of the range,
 *    once the range has at least MIN_PERIODS such periods.
 */

export const MIN_PERIODS = 6;
export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
/** Most bars a chart draws; a longer range moves to the next coarser grouping (day, week, month). */
export const MAX_PERIODS = 130;

export type ConsumptionPoint = { key: string; label: string; issued: number; returned: number; net: number; unusual: boolean };

export type MaterialComparison = {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  current: number;
  previous: number;
  currentValue: number;
  previousValue: number;
  /** current / previous - 1; null when nothing was used before. */
  change: number | null;
  pattern: "up" | "down" | "stopped" | "new" | null;
};

export type ProjectComparison = { projectId: string; name: string; code: string; color: string; current: number; previous: number; change: number | null };

export type ConsumptionData = {
  series: ConsumptionPoint[];
  /** The grouping used: the one asked for, or a coarser one when that gave too many bars. */
  granularity: Granularity;
  /** The grouping asked for, when it was too fine for the range. */
  coarsenedFrom: Granularity | null;
  average: number;
  enoughPeriods: boolean;
  totals: { current: number; previous: number; change: number | null };
  materials: MaterialComparison[];
  projects: ProjectComparison[];
  previous: AnalyticsRange;
  unusualMaterials: MaterialComparison[];
};

/** Monday of the IST week containing `day`. */
function weekStart(day: string): string {
  const d = fromDateInput(day);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return toDateInput(addDays(d, -((weekday + 6) % 7)));
}

const keyOf = (day: string, g: Granularity) => (g === "day" ? day : g === "week" ? weekStart(day) : day.slice(0, 7));

function labelOf(key: string, g: Granularity): string {
  const fmt = (opts: Intl.DateTimeFormatOptions, iso: string) => new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(iso));
  if (g === "month") return fmt({ month: "short", year: "2-digit" }, `${key}-01T00:00:00Z`);
  const s = fmt({ day: "numeric", month: "short" }, `${key}T00:00:00Z`);
  return g === "week" ? `Week of ${s}` : s;
}

/** Every period key from the range's first day to its last, so empty periods show as zero. */
function periodKeys(range: AnalyticsRange, g: Granularity): string[] {
  const keys: string[] = [];
  for (let d = range.start; d.getTime() <= range.end.getTime(); d = addDays(d, 1)) {
    const k = keyOf(toDateInput(d), g);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

/** The granularity a range reads best in when the URL does not choose one. */
export const defaultGranularity = (days: number): Granularity => (days <= 45 ? "day" : days <= 200 ? "week" : "month");

function seriesOf(rows: MovementFact[], range: AnalyticsRange, g: Granularity) {
  const keys = periodKeys(range, g);
  const by = new Map(keys.map((k) => [k, { key: k, label: labelOf(k, g), issued: 0, returned: 0, net: 0, unusual: false }]));
  for (const m of rows) {
    if (m.type !== "assign" && m.type !== "return") continue;
    const p = by.get(keyOf(m.day, g));
    if (!p) continue;
    if (m.type === "assign") p.issued = round2(p.issued + m.totalCost);
    else p.returned = round2(p.returned + m.totalCost);
  }
  const series = [...by.values()].map((p) => ({ ...p, net: round2(p.issued - p.returned) }));
  const average = series.length ? round2(series.reduce((s, p) => s + p.net, 0) / series.length) : 0;
  const enough = series.length >= MIN_PERIODS;
  if (enough && average > 0) for (const p of series) p.unusual = p.net > 2 * average;
  return { series, average, enough };
}

/** Net consumed value per item and per project in a set of movements. */
function valueBy(rows: MovementFact[], pick: (m: MovementFact) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of rows) {
    if (m.type !== "assign" && m.type !== "return") continue;
    const k = pick(m);
    if (!k) continue;
    out.set(k, round2((out.get(k) ?? 0) + (m.type === "assign" ? m.totalCost : -m.totalCost)));
  }
  return out;
}

const changeOf = (current: number, previous: number) => (previous > 0 ? current / previous - 1 : null);

/** The unusual-pattern label for one material (rule in the header). Exported for tests. */
export function patternOf(current: number, previous: number): MaterialComparison["pattern"] {
  if (previous <= 0) return current > 0 ? "new" : null;
  if (current <= 0) return "stopped";
  if (current >= 2 * previous) return "up";
  if (current <= previous / 2) return "down";
  return null;
}

/** The asked grouping, or the first coarser one that keeps the chart within MAX_PERIODS bars. */
export function fittingGranularity(range: AnalyticsRange, asked: Granularity): Granularity {
  const days = range.days;
  const count: Record<Granularity, number> = { day: days, week: Math.ceil(days / 7) + 1, month: Math.ceil(days / 28) + 1 };
  const from = GRANULARITIES.indexOf(asked);
  return GRANULARITIES.slice(from).find((g) => count[g] <= MAX_PERIODS) ?? "month";
}

export async function getConsumption(range: AnalyticsRange, asked: Granularity): Promise<ConsumptionData> {
  const granularity = fittingGranularity(range, asked);
  const prev = previousRange(range);
  const [rows, prevRows, usageNow, usageBefore, items, projects] = await Promise.all([
    loadMovements(range.start, range.end),
    loadMovements(prev.start, prev.end),
    usageByItem(range.days, range.end),
    usageByItem(prev.days, prev.end),
    itemNames(),
    projectNames(),
  ]);
  const { series, average, enough } = seriesOf(rows, range, granularity);

  const valueNow = valueBy(rows, (m) => m.item);
  const valueBefore = valueBy(prevRows, (m) => m.item);
  const ids = new Set([...usageNow.keys(), ...usageBefore.keys()]);
  const materials: MaterialComparison[] = [...ids]
    .map((id) => {
      const it = items.get(id);
      const current = usageNow.get(id)?.consumed ?? 0;
      const previous = usageBefore.get(id)?.consumed ?? 0;
      return {
        itemId: id,
        name: it?.name ?? "Deleted item",
        sku: it?.sku ?? "",
        unit: it?.unit ?? "pcs",
        current: round3(current),
        previous: round3(previous),
        currentValue: Math.max(0, valueNow.get(id) ?? 0),
        previousValue: Math.max(0, valueBefore.get(id) ?? 0),
        change: changeOf(current, previous),
        pattern: patternOf(current, previous),
      };
    })
    .filter((m) => m.current > 0 || m.previous > 0)
    .sort((a, b) => b.currentValue - a.currentValue || b.current - a.current);

  const projNow = valueBy(rows, (m) => m.project);
  const projBefore = valueBy(prevRows, (m) => m.project);
  const projectRows: ProjectComparison[] = [...new Set([...projNow.keys(), ...projBefore.keys()])]
    .map((id) => {
      const p = projects.get(id);
      const current = projNow.get(id) ?? 0;
      const previous = projBefore.get(id) ?? 0;
      return { projectId: id, name: p?.name ?? "Deleted project", code: p?.code ?? "", color: p?.color ?? "#94a3b8", current, previous, change: changeOf(current, previous) };
    })
    .filter((p) => p.current !== 0 || p.previous !== 0)
    .sort((a, b) => b.current - a.current);

  const current = round2(series.reduce((s, p) => s + p.net, 0));
  const previous = round2([...valueBefore.values()].reduce((s, v) => s + v, 0));
  return {
    series,
    granularity,
    coarsenedFrom: granularity === asked ? null : asked,
    average,
    enoughPeriods: enough,
    totals: { current, previous, change: changeOf(current, previous) },
    materials,
    projects: projectRows,
    previous: prev,
    unusualMaterials: materials.filter((m) => m.pattern === "up" || m.pattern === "down" || m.pattern === "stopped"),
  };
}
