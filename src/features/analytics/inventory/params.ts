import { addDays, endOfDayIST, financialYearIST, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { SearchParams } from "@/lib/list-params";

/**
 * URL parameters of the inventory and project analytics pages, parsed one way. Client-safe.
 * Every page keeps its choices in the URL, so a link reproduces exactly what was on screen.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export type AnalyticsRange = {
  /** "yyyy-mm-dd", inclusive. */
  from: string;
  to: string;
  /** Calendar days in the range, both ends included. */
  days: number;
  /** IST midnight of `from`. */
  start: Date;
  /** The last millisecond of `to` (IST). */
  end: Date;
  /** True when the URL set no range and the page default applies. */
  isDefault: boolean;
  /** "1 Apr 2026 to 24 Nov 2026" */
  label: string;
};

/**
 * The longest range a page reads, about ten years. Older starts are moved up to it, so a
 * hand-edited URL (from=1900-01-01) cannot make a page load and draw tens of thousands of days.
 */
export const MAX_RANGE_DAYS = 3653;

/** A real calendar day in "yyyy-mm-dd" form; 2026-02-31 is not one (it would roll over to March). */
const isCalendarDay = (s: string) => DATE_RE.test(s) && toDateInput(fromDateInput(s)) === s;

/** Inclusive calendar days between two "yyyy-mm-dd" days. */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateInput(to).getTime() - fromDateInput(from).getTime()) / DAY_MS) + 1;
}

function buildRange(from: string, to: string, isDefault: boolean): AnalyticsRange {
  const start = fromDateInput(from);
  return {
    from,
    to,
    days: daysBetween(from, to),
    start,
    end: endOfDayIST(fromDateInput(to)),
    isDefault,
    label: `${formatDate(start)} to ${formatDate(fromDateInput(to))}`,
  };
}

/**
 * The page's date range from ?from&to. Without one, `fallback` applies: "fy" is this financial
 * year to date, a number is that many days up to today. A range whose end is before its start
 * falls back too, so a hand-edited URL never shows a negative period.
 */
export function parseRange(sp: SearchParams, fallback: "fy" | number, now: Date = new Date()): AnalyticsRange {
  const today = toDateInput(now);
  const rawFrom = firstParam(sp.from);
  const rawTo = firstParam(sp.to);
  const from = isCalendarDay(rawFrom) ? rawFrom : null;
  const to = isCalendarDay(rawTo) ? rawTo : null;
  if (from || to) {
    // Movements are recorded up to today, so a range ending later (a financial year preset)
    // stops at today: a daily rate over days still to come would understate it.
    const t = to && to < today ? to : today;
    const earliest = toDateInput(addDays(fromDateInput(t), -(MAX_RANGE_DAYS - 1)));
    const f = from ?? to!;
    if (t >= f) return buildRange(f < earliest ? earliest : f, t, false);
  }
  if (fallback === "fy") return buildRange(toDateInput(financialYearIST(now).start), today, true);
  return buildRange(toDateInput(addDays(fromDateInput(today), -(fallback - 1))), today, true);
}

/** The range of the same length that ends the day before `range` starts (for comparisons). */
export function previousRange(range: AnalyticsRange): AnalyticsRange {
  const to = toDateInput(addDays(range.start, -1));
  const from = toDateInput(addDays(range.start, -range.days));
  return buildRange(from, to, false);
}

/** A whole number from the URL, one of `allowed` when given, otherwise inside [min, max]. */
export function intParam(
  sp: SearchParams,
  key: string,
  options: { fallback: number; min?: number; max?: number; allowed?: readonly number[] },
): number {
  const n = Number.parseInt(firstParam(sp[key]), 10);
  if (!Number.isFinite(n)) return options.fallback;
  if (options.allowed) return options.allowed.includes(n) ? n : options.fallback;
  if (options.min !== undefined && n < options.min) return options.fallback;
  if (options.max !== undefined && n > options.max) return options.fallback;
  return n;
}

/** A value from the URL that must be one of `allowed`. */
export function choiceParam<T extends string>(sp: SearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const v = firstParam(sp[key]) as T;
  return allowed.includes(v) ? v : fallback;
}

/** A Mongo ObjectId-shaped id from the URL, or null. */
export function idParam(sp: SearchParams, key: string): string | null {
  const v = firstParam(sp[key]);
  return /^[a-f\d]{24}$/i.test(v) ? v : null;
}

export const DEFAULT_AGE_EDGES = [30, 60, 90] as const;

/**
 * Ageing bucket edges from ?b=30,60,90: whole days, strictly rising, 1 to 3650, at most five.
 * Anything else gives the default 0-30, 31-60, 61-90 and more than 90 days.
 */
export function ageEdgesParam(sp: SearchParams): number[] {
  const raw = firstParam(sp.b);
  if (!raw) return [...DEFAULT_AGE_EDGES];
  const parts = raw.split(",").map((s) => s.trim());
  const edges = parts.map((s) => (/^\d+$/.test(s) ? Number(s) : NaN));
  const ok =
    edges.length >= 1 &&
    edges.length <= 5 &&
    edges.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 3650 && (i === 0 || n > edges[i - 1]));
  return ok ? edges : [...DEFAULT_AGE_EDGES];
}

/** Query string for links that keep the page's range and add or change other values. */
export function withParams(base: Record<string, string | null | undefined>, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

/** The range part of a query string, only when the URL set it (so default ranges stay default). */
export const rangeQuery = (range: AnalyticsRange) => (range.isDefault ? {} : { from: range.from, to: range.to });
