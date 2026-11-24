import { addDays, fromDateInput, toDateInput } from "@/lib/dates";
import { DEFAULT_WINDOW_DAYS, HORIZONS, MAX_WINDOW_DAYS, MIN_WINDOW_DAYS, type Horizon } from "./constants";

/**
 * URL parameters of the forecasting pages: the history window (?from&to), material (?item),
 * category (?category), project (?project) and the purchase horizon (?horizon). Client-safe.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-f0-9]{24}$/i;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export type HistoryWindow = {
  /** "yyyy-mm-dd", inclusive. */
  from: string;
  to: string;
  /** Calendar days in the window, both ends included. */
  days: number;
  /** True when the person did not pick a window (the last 90 days). */
  isDefault: boolean;
  /** Why the picked window was changed, when it was. */
  adjusted: string | null;
};

/** Inclusive IST day count between two "yyyy-mm-dd" days. */
export function dayCount(from: string, to: string): number {
  return Math.round((fromDateInput(to).getTime() - fromDateInput(from).getTime()) / DAY_MS) + 1;
}

/** The history window from ?from&to: the last 90 days by default, never in the future, 30 days to two years long. */
export function resolveWindow(sp: SearchParams, now: Date = new Date()): HistoryWindow {
  const today = toDateInput(now);
  let from = first(sp.from);
  let to = first(sp.to);
  if (!DATE_RE.test(from) && !DATE_RE.test(to)) {
    return { from: toDateInput(addDays(fromDateInput(today), -(DEFAULT_WINDOW_DAYS - 1))), to: today, days: DEFAULT_WINDOW_DAYS, isDefault: true, adjusted: null };
  }
  const notes: string[] = [];
  // "2026-02-31" passes the pattern; read it as the day the calendar makes of it (3 Mar).
  const normal = (v: string) => (DATE_RE.test(v) ? toDateInput(fromDateInput(v)) : v);
  from = normal(from);
  to = normal(to);
  if (!DATE_RE.test(to) || to > today) {
    if (DATE_RE.test(to)) notes.push("The window cannot end after today, so it ends today.");
    to = today;
  }
  if (!DATE_RE.test(from)) from = toDateInput(addDays(fromDateInput(to), -(DEFAULT_WINDOW_DAYS - 1)));
  if (from > today) from = today;
  if (from > to) [from, to] = [to, from];
  let days = dayCount(from, to);
  if (days < MIN_WINDOW_DAYS) {
    from = toDateInput(addDays(fromDateInput(to), -(MIN_WINDOW_DAYS - 1)));
    days = MIN_WINDOW_DAYS;
    notes.push(`Rates need at least ${MIN_WINDOW_DAYS} days of history, so the window was widened to ${MIN_WINDOW_DAYS} days.`);
  } else if (days > MAX_WINDOW_DAYS) {
    from = toDateInput(addDays(fromDateInput(to), -(MAX_WINDOW_DAYS - 1)));
    days = MAX_WINDOW_DAYS;
    notes.push("The window was cut to two years.");
  }
  return { from, to, days, isDefault: false, adjusted: notes.length ? notes.join(" ") : null };
}

export type ForecastFilters = {
  item: string | null;
  category: string | null;
  project: string | null;
};

export function parseFilters(sp: SearchParams): ForecastFilters {
  const id = (key: string) => {
    const v = first(sp[key]);
    return ID_RE.test(v) ? v : null;
  };
  return { item: id("item"), category: id("category"), project: id("project") };
}

/** ?horizon, one of the offered horizons; 30 days by default. */
export function parseHorizon(sp: SearchParams): Horizon {
  const n = Number(first(sp.horizon));
  return (HORIZONS as readonly number[]).includes(n) ? (n as Horizon) : 30;
}
