import { endOfDayIST, financialYearIST, fromDateInput, startOfMonthIST, toDateInput } from "@/lib/dates";

/** Period switcher values for the finance dashboard. Client-safe. */
export const DASHBOARD_PERIODS = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "fy", label: "Fin. year" },
  { value: "all", label: "All time" },
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["value"];

export const DEFAULT_PERIOD: DashboardPeriod = "fy";

export function parsePeriod(value: string | string[] | undefined): DashboardPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_PERIODS.some((p) => p.value === v) ? (v as DashboardPeriod) : DEFAULT_PERIOD;
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

/** Date bounds (IST) of a dashboard period and the equal period before it. */
export function resolvePeriod(period: DashboardPeriod, now: Date = new Date()): PeriodRange {
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
