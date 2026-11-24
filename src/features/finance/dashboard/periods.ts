import { addDays, endOfDayIST, financialYearIST, fromDateInput, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/** Period switcher values for the finance dashboard. Client-safe. */
export const DASHBOARD_PERIODS = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "fy", label: "Fin. year" },
  { value: "all", label: "All time" },
] as const;

/** A preset, or "custom" for a from / to range picked by the user (?period=custom&from=&to=). */
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["value"] | "custom";

export const DEFAULT_PERIOD: DashboardPeriod = "fy";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A preset period from ?period=. "custom" needs its dates, so it is read with parsePeriodParams. */
export function parsePeriod(value: string | string[] | undefined): DashboardPeriod {
  const v = first(value);
  return DASHBOARD_PERIODS.some((p) => p.value === v) ? (v as DashboardPeriod) : DEFAULT_PERIOD;
}

/** The period the URL asks for, with the custom range's days ("yyyy-mm-dd"). */
export type PeriodSelection = { period: DashboardPeriod; from?: string; to?: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day in yyyy-mm-dd form (2026-02-30 is not). */
export function isDayInput(value: string | undefined): value is string {
  return Boolean(value && DAY_RE.test(value) && toDateInput(fromDateInput(value)) === value);
}

/**
 * Reads ?period=, ?from= and ?to=. A custom range needs both days; reversed days are swapped;
 * anything invalid falls back to the default period.
 */
export function parsePeriodParams(params: { period?: string | string[]; from?: string | string[]; to?: string | string[] }): PeriodSelection {
  if (first(params.period) !== "custom") return { period: parsePeriod(params.period) };
  const a = first(params.from);
  const b = first(params.to);
  if (!isDayInput(a) || !isDayInput(b)) return { period: DEFAULT_PERIOD };
  return a <= b ? { period: "custom", from: a, to: b } : { period: "custom", from: b, to: a };
}

export type PeriodRange = {
  period: DashboardPeriod;
  /** Shown in headings, e.g. "FY 2026-27". */
  label: string;
  /** Lower-case phrase for hints, e.g. "this financial year". */
  phrase: string;
  from?: Date;
  to?: Date;
  /**
   * The same stretch of the previous period: from its start to the same day as
   * today (20 Nov compares with 20 Oct, 20 Aug or 20 Nov last year). Absent for "all".
   */
  previous?: { from: Date; to: Date; phrase: string };
};

const before = (d: Date) => new Date(d.getTime() - 1);

/**
 * The end of the IST day `months` months before `now`, on the same day of the
 * month, or the month's last day when it is shorter (31 Mar gives 28 Feb).
 */
function sameDayMonthsBack(now: Date, months: number): Date {
  const [y, m, d] = toDateInput(now).split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - months, 0)).getUTCDate();
  const day = new Date(Date.UTC(y, m - 1 - months, Math.min(d, lastDay)));
  return endOfDayIST(fromDateInput(day.toISOString().slice(0, 10)));
}

/**
 * The previous period cut at the same point as today. The current period only
 * has data up to today, so comparing it with the whole previous period would
 * show a fall on every day but the last.
 */
function previousToDate(now: Date, months: number, from: Date, phrase: string) {
  const end = Math.min(sameDayMonthsBack(now, months).getTime(), before(from).getTime());
  return { from: startOfMonthIST(from, -months), to: new Date(end), phrase };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A custom range, compared with the same number of days just before it. Like the presets, the
 * previous side is cut at the same point as today when the range runs past today.
 */
function customRange(fromDay: string, toDay: string, now: Date): PeriodRange {
  const from = fromDateInput(fromDay);
  const to = endOfDayIST(fromDateInput(toDay));
  const days = Math.round((startOfDayIST(to).getTime() - from.getTime()) / DAY_MS) + 1;
  const today = endOfDayIST(now);
  const elapsedEnd = Math.min(to.getTime(), today.getTime());
  const prevFrom = addDays(from, -days);
  const previous =
    from.getTime() <= today.getTime()
      ? { from: prevFrom, to: new Date(prevFrom.getTime() + (elapsedEnd - from.getTime())), phrase: `the ${days} ${days === 1 ? "day" : "days"} before` }
      : undefined;
  const label = fromDay === toDay ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`;
  return { period: "custom", label, phrase: "in this date range", from, to, previous };
}

/** Date bounds (IST) of a dashboard period and the equal period before it. */
export function resolvePeriod(period: DashboardPeriod, now: Date = new Date(), custom?: { from?: string; to?: string }): PeriodRange {
  if (period === "custom") {
    if (isDayInput(custom?.from) && isDayInput(custom?.to)) return customRange(custom.from, custom.to, now);
    return resolvePeriod(DEFAULT_PERIOD, now);
  }
  if (period === "month") {
    const from = startOfMonthIST(now);
    const next = startOfMonthIST(now, 1);
    return {
      period,
      label: "This month",
      phrase: "this month",
      from,
      to: before(next),
      previous: previousToDate(now, 1, from, "same days last month"),
    };
  }
  if (period === "quarter") {
    // Financial quarters start in April, July, October and January.
    const month = Number(toDateInput(now).slice(5, 7));
    const intoQuarter = ((month - 4 + 12) % 12) % 3;
    const from = startOfMonthIST(now, -intoQuarter);
    const next = startOfMonthIST(now, -intoQuarter + 3);
    return {
      period,
      label: "This quarter",
      phrase: "this quarter",
      from,
      to: before(next),
      previous: previousToDate(now, 3, from, "same days last quarter"),
    };
  }
  if (period === "fy") {
    const fy = financialYearIST(now);
    return {
      period,
      label: fy.label,
      phrase: "this financial year",
      from: fy.start,
      to: fy.end,
      previous: previousToDate(now, 12, fy.start, "same date last year"),
    };
  }
  return { period, label: "All time", phrase: "across all time" };
}

/** Series key for the folded "Other" expense categories in the stacked chart. */
export const OTHER_KEY = "other_group";
