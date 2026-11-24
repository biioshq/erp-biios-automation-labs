/**
 * The rules every forecast on these pages follows, in one place so the pages, the stored
 * snapshots and the method notes always agree. Client-safe.
 *
 * Forecasts come only from recorded movements, expenses, maintenance entries and project
 * memberships. Where the record is too thin, the pages say so instead of predicting.
 */

/** Days of history a rate is taken over unless the person picks another window. */
export const DEFAULT_WINDOW_DAYS = 90;
/** A shorter window gives rates that swing on one assignment, so windows are at least this long. */
export const MIN_WINDOW_DAYS = 30;
/** Windows longer than two years are cut to two years. */
export const MAX_WINDOW_DAYS = 730;

/** An item needs at least this many assignments or returns in the window to be forecast. */
export const MIN_MOVEMENTS = 3;
/** And its first recorded movement must be at least this many days before the window ends. */
export const MIN_HISTORY_DAYS = 30;

/** Days ahead the demand page predicts. */
export const HORIZONS = [7, 15, 30, 60, 90] as const;
export type Horizon = (typeof HORIZONS)[number];
/** The horizon "extra needed" and the stored monthly forecast use. */
export const SNAPSHOT_HORIZON_DAYS = 30;

/** Stock that lasts longer than this at the recent rate may be overstocked (twice the default window). */
export const OVERSTOCK_DAYS = 180;
/** Seasonal patterns need a full year of recorded use. */
export const SEASONAL_MIN_MONTHS = 12;

/** Unusual change rule: the last 30 days against the 90 days before them. */
export const UNUSUAL_RECENT_DAYS = 30;
export const UNUSUAL_PRIOR_DAYS = 90;
/** Flag when the recent daily rate is more than 50% above or below the prior one. */
export const UNUSUAL_RATIO = 0.5;
/** Ignore items that moved fewer units than this across both periods (too little to judge). */
export const UNUSUAL_MIN_UNITS = 5;

/** Project run rates need this many days since the project started (the shared project forecast rule). */
export { MIN_PROJECT_DAYS } from "../project-forecast";

/** Equipment: warranty ending within this many days needs attention; due lists look this far ahead. */
export const WARRANTY_SOON_DAYS = 60;
export const MAINTENANCE_LOOKAHEAD = [30, 60] as const;

/** Manpower timeline: months ahead, this month included. */
export const MANPOWER_MONTHS = 6;

/** A forecast off by more than this share of itself counts as a major difference. */
export const MAJOR_DEVIATION = 0.25;

export const METHOD_DEMAND =
  `Average daily use (units assigned to projects less units returned in the history window, divided by the days from the material's first assignment in the window to the window's end, never fewer than ${MIN_HISTORY_DAYS}), multiplied by the number of days ahead. Wastage is not counted as use.`;
