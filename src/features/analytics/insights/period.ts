import { endOfDayIST, financialYearIST, startOfMonthIST } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/** Period choices for the procurement and vendor pages, read from ?period=. Client-safe. */

export const INSIGHT_PERIODS = [
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "fy", label: "This FY" },
  { value: "all", label: "All time" },
] as const;

export type InsightPeriod = (typeof INSIGHT_PERIODS)[number]["value"];
export const DEFAULT_PERIOD: InsightPeriod = "12m";

export function parsePeriod(value: string | string[] | undefined): InsightPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return INSIGHT_PERIODS.some((p) => p.value === v) ? (v as InsightPeriod) : DEFAULT_PERIOD;
}

export type ResolvedPeriod = { period: InsightPeriod; from: Date | null; to: Date; phrase: string };

/** Calendar months up to and including this one, the financial year to date, or everything. */
export function resolvePeriod(period: InsightPeriod, now: Date = new Date()): ResolvedPeriod {
  const to = endOfDayIST(now);
  if (period === "all") return { period, from: null, to, phrase: "all recorded time" };
  if (period === "fy") {
    const fy = financialYearIST(now);
    return { period, from: fy.start, to, phrase: `${fy.label} to date` };
  }
  const months = Number(period.replace("m", ""));
  const from = startOfMonthIST(now, -(months - 1));
  return { period, from, to, phrase: `the last ${months} months (since ${formatDate(from)})` };
}

/** Mongo date filter for a resolved period. */
export function periodMatch(p: ResolvedPeriod): { $gte?: Date; $lte: Date } {
  return p.from ? { $gte: p.from, $lte: p.to } : { $lte: p.to };
}
