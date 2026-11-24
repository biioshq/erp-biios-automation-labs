import { fromDateInput } from "@/lib/dates";
import { PROJECT_FORECAST_RULE } from "../project-forecast";
import { BUDGET_USE_RULE } from "../projects/model";

/**
 * The rules behind the Analytics dashboard and insights figures, in one place so each page
 * can state the rule it uses next to the figure. Client-safe.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days from one "yyyy-mm-dd" day to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateInput(to).getTime() - fromDateInput(from).getTime()) / DAY_MS);
}

/** "2026-11" → "Nov 26" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Vendor names are matched without case or extra spaces; blank names are one group. */
export function vendorKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export const NO_VENDOR = "Vendor not recorded";

/** Look-ahead for purchase requirements and maintenance. */
export const LOOK_AHEAD_DAYS = 30;
/** Months shown in the monthly charts. */
export const TREND_MONTHS = 12;

export const RULES = {
  shortages: "Items out of stock, at or below their minimum, or running out within their lead time plus a week at the rate used over the last 90 days. The same list as Shortage risk and the inventory alerts.",
  purchases: "Items to buy so stock lasts the next 30 days plus the lead time at the forecast rate, and stays at its minimum: quantity = daily rate × (30 + lead time) + minimum − available. The daily rate is the use in the last 90 days divided by the days from the item's first assignment in them (at least 30). Items with fewer than 3 assignments or returns in 90 days, or under 30 days of history, have no rate and are only brought back to their minimum. Cost is quantity × the last purchase price, else the average cost. The same list as Purchase requirements.",
  overruns: `Open projects with a budget that are over it by the forecast, or already. ${PROJECT_FORECAST_RULE} The same rule as Project cost forecast and Cost overruns.`,
  delays: "Active projects with tasks past their due date that are not done, or whose end date has passed.",
  budget: `Active projects. ${BUDGET_USE_RULE} Spend is project spend, as on every project page. The same figure as Budget vs actual for active projects.`,
  maintenance: "Equipment (assets marked as equipment, or in machinery, computers and vehicles) whose next service falls within 30 days or has passed. Next service is the due date on the latest maintenance record, or the last service plus the average gap between recorded services. The same rule as Equipment maintenance.",
  manpower: "People whose current project memberships (active or on-hold projects, started and not ended) add up to more than 100% of their time, and active projects with nobody assigned. The same memberships as Manpower requirement.",
  inventory: "Stock on hand at its average cost (available × average cost). Stock already issued to projects is their cost and is not counted again.",
  consumption: "Value of stock issued to projects less stock returned, by month of the movement. Wastage is shown apart and is never counted as use.",
  ageing: "Stock in storage by age, as on Inventory ageing: the units on hand are taken to be the latest purchases (first in, first out), each aged from its purchase day. Units no recorded purchase covers (adjustments, opening stock entered as already on hand) have no known age. Valued at average cost.",
  velocity: "Last 90 days, as on Fast and slow moving: items issued to projects are ranked by issues per month and by the share of their stock used, and split into thirds. Not moving: stock in storage and no issue in 90 days (items first recorded inside the 90 days are shown apart). Values are stock in storage at average cost.",
  procurement: "Stock bought through the ERP (purchase entries that booked an expense), by month, before GST. Opening and imported stock is not a purchase and is left out.",
  performance: "For active projects: share of the planned time gone by, share of the budget spent, and share of tasks done (cancelled tasks left out).",
} as const;
