import { fromDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";

/**
 * The one project cost forecast rule. Project cost analysis, Cost overruns, Project cost forecast
 * and the Analytics dashboard all call forecastProjectCost, so they predict the same cost and flag
 * the same projects. Client-safe and pure.
 *
 * Forecasts are never invented: a prediction needs a start date at least MIN_PROJECT_DAYS days ago,
 * some recorded spend and a planned end that has not passed. Predicted cost = spent + daily rate
 * (spent / days since the start) x days left to the planned end. Once an open project is past its
 * planned end, or on hold, the figure is its spend to date, marked as such, and it counts as over
 * budget only when that spend is already above the budget. Without a planned end there is no
 * prediction. Unspent budget is never assumed to be spent.
 */

/** A spend rate needs this many days since the project started. */
export const MIN_PROJECT_DAYS = 30;

/** The rule as every page states it next to its figures. */
export const PROJECT_FORECAST_RULE =
  `Predicted final cost = spent so far + daily spend rate × days left to the planned end, where the daily rate is spend to date ÷ days since the start date. ` +
  `A prediction needs a start date at least ${MIN_PROJECT_DAYS} days ago, some recorded spend and a planned end that has not passed. ` +
  `Once an open project is past its planned end, or on hold, its spend to date is shown instead (marked as such) and it counts as over budget only when that spend is already above the budget. ` +
  `Projects without a planned end get no prediction. Unspent budget is never assumed to be spent. Closed projects show their actual spend.`;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromTo = (from: string, to: string) => Math.round((fromDateInput(to).getTime() - fromDateInput(from).getTime()) / DAY_MS);

/**
 * rate: predicted by the spend rate. spend_to_date: past the planned end or on hold, the spend so
 * far. actual: closed, the final spend. none: no figure, the note says why.
 */
export type ForecastBasis = "rate" | "spend_to_date" | "actual" | "none";

export type ProjectForecast = {
  basis: ForecastBasis;
  /** Predicted final cost (rate), spend to date (spend_to_date), final spend (actual); null for none. */
  value: number | null;
  /** Short mark shown beside the figure; null for none. */
  label: string | null;
  /** What the figure rests on, or why there is none. */
  note: string;
  /** Days from the start to today, both included; 0 before the start; null without a start date. */
  daysElapsed: number | null;
  /** Days from today to the planned end, 0 once it has passed; null without a planned end. */
  daysRemaining: number | null;
  /** Spend per day since the start; only set when the prediction uses it. */
  dailyRate: number | null;
  /**
   * The figure less the budget for rate and actual (negative is under budget). For spend_to_date
   * and none, only spend already above the budget counts (a late project never shows a saving).
   * Null without a budget, or when nothing can be said.
   */
  variance: number | null;
  /** The variance when above 0, else 0: what flags a project as over budget. */
  overrun: number;
};

export type ForecastInput = {
  status: string;
  /** "yyyy-mm-dd" (IST), or null when not set. */
  startDate: string | null;
  endDate: string | null;
  budget: number;
  spent: number;
};

/** The forecast for one project on `today` ("yyyy-mm-dd", IST). */
export function forecastProjectCost(p: ForecastInput, today: string): ProjectForecast {
  const daysElapsed = p.startDate ? (p.startDate <= today ? daysFromTo(p.startDate, today) + 1 : 0) : null;
  const daysRemaining = p.endDate ? Math.max(0, daysFromTo(today, p.endDate)) : null;
  const alreadyOver = p.budget > 0 && p.spent > p.budget ? round2(p.spent - p.budget) : 0;

  const make = (basis: ForecastBasis, value: number | null, label: string | null, note: string, dailyRate: number | null = null): ProjectForecast => {
    let variance: number | null = null;
    if (p.budget > 0) {
      if ((basis === "rate" || basis === "actual") && value !== null) variance = round2(value - p.budget);
      else if (alreadyOver > 0) variance = alreadyOver;
    }
    return { basis, value, label, note, daysElapsed, daysRemaining, dailyRate, variance, overrun: variance !== null && variance > 0 ? variance : 0 };
  };

  if (p.status === "completed" || p.status === "cancelled") return make("actual", p.spent, "Final (closed)", "Closed: the actual spend is the final cost");
  if (!p.endDate) return make("none", null, null, "No planned end date, so there is nothing to carry the spend rate to");
  if (p.endDate < today) {
    return make(
      "spend_to_date",
      p.spent,
      "Past planned end, spend to date",
      `Past its planned end on ${formatDate(fromDateInput(p.endDate))} and still open: spend to date, no prediction`,
    );
  }
  if (p.status === "on_hold") return make("spend_to_date", p.spent, "On hold, spend to date", "On hold: spending is paused, so no rate is carried forward");
  if (!p.startDate) return make("none", null, null, "No start date, so there is no spend rate");
  if (p.startDate > today) return make("none", null, null, `Starts on ${formatDate(fromDateInput(p.startDate))}, so there is no spend rate yet`);
  const elapsed = daysElapsed ?? 0;
  // "At least MIN_PROJECT_DAYS days ago": whole days from the start date to today. The rate itself
  // divides by elapsed, which counts the start day too (a project that started today has 1 day of spend).
  const since = elapsed - 1;
  if (since < MIN_PROJECT_DAYS) {
    const started = since === 0 ? "Started today" : `Started ${since} ${since === 1 ? "day" : "days"} ago`;
    return make("none", null, null, `${started} (${MIN_PROJECT_DAYS} days needed for a spend rate)`);
  }
  if (!(p.spent > 0)) return make("none", null, null, "No spend recorded yet");
  const rate = p.spent / elapsed;
  const value = round2(p.spent + rate * (daysRemaining ?? 0));
  return make("rate", value, "Spend rate", `Spend rate over ${elapsed} days, carried to the planned end`, rate);
}
