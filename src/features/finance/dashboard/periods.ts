import { financialYearIST, startOfMonthIST, toDateInput } from "@/lib/dates";

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
  /** The previous period of equal length; absent for "all". */
  previous?: { from: Date; to: Date; phrase: string };
};

const before = (d: Date) => new Date(d.getTime() - 1);

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
      previous: { from: startOfMonthIST(now, -1), to: before(from), phrase: "last month" },
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
      previous: { from: startOfMonthIST(now, -intoQuarter - 3), to: before(from), phrase: "last quarter" },
    };
  }
  if (period === "fy") {
    const fy = financialYearIST(now);
    const prev = financialYearIST(before(fy.start));
    return {
      period,
      label: fy.label,
      phrase: "this financial year",
      from: fy.start,
      to: fy.end,
      previous: { from: prev.start, to: prev.end, phrase: "last financial year" },
    };
  }
  return { period, label: "All time", phrase: "across all time" };
}

/** Series key for the folded "Other" expense categories in the stacked chart. */
export const OTHER_KEY = "other_group";
