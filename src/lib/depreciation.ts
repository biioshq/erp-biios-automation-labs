/**
 * Depreciation and amortisation of fixed and intangible assets, computed month by month.
 * Client-safe and pure. Nothing here is stored: the register, the depreciation report and the
 * balance sheet all call these, so a figure is computed one way everywhere.
 *
 * - Straight line: (cost − salvage) ÷ useful life, spread evenly per month.
 * - Written down value: each month, book value × yearly rate ÷ 12; never below salvage.
 * A month counts from the depreciation start date (purchase date by default): an asset put to use
 * in a month is depreciated from the next month's first day, pro rata by days in its first month.
 * Disposal stops depreciation on the disposal date.
 */

import type { DepreciationMethod } from "./constants";

export type DepreciableAsset = {
  purchaseCost: number;
  salvageValue?: number | null;
  usefulLifeYears?: number | null;
  depreciationMethod?: DepreciationMethod | string | null;
  wdvRate?: number | null;
  purchaseDate: Date | string;
  depreciationStart?: Date | string | null;
  disposal?: { date: Date | string } | null;
};

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** IST calendar parts of an instant. */
function ist(d: Date) {
  const t = new Date(d.getTime() + IST);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Depreciation charged from the start up to the end of the IST day `asOf` (inclusive), and per
 * month for a schedule. Returns 0s for "none" or a zero life.
 */
export function depreciationSchedule(asset: DepreciableAsset, asOf: Date): { month: string; amount: number }[] {
  const method = (asset.depreciationMethod ?? "slm") as DepreciationMethod;
  const cost = Math.max(0, asset.purchaseCost || 0);
  const salvage = Math.min(cost, Math.max(0, asset.salvageValue || 0));
  const lifeMonths = Math.round((asset.usefulLifeYears || 0) * 12);
  if (method === "none" || cost <= 0 || cost - salvage <= 0) return [];
  if (method === "slm" && lifeMonths <= 0) return [];
  if (method === "wdv" && !(asset.wdvRate && asset.wdvRate > 0)) return [];

  const start = new Date(asset.depreciationStart ?? asset.purchaseDate);
  const stopAt = asset.disposal?.date ? Math.min(new Date(asset.disposal.date).getTime(), asOf.getTime()) : asOf.getTime();
  if (stopAt < start.getTime()) return [];
  const s = ist(start);
  const e = ist(new Date(stopAt));

  const out: { month: string; amount: number }[] = [];
  let book = cost;
  let charged = 0;
  let elapsed = 0;
  const slmMonthly = (cost - salvage) / Math.max(1, lifeMonths);
  for (let y = s.y, m = s.m; y < e.y || (y === e.y && m <= e.m); m === 11 ? ((m = 0), y++) : m++) {
    const dim = daysInMonth(y, m);
    const firstDay = y === s.y && m === s.m ? s.d : 1;
    const lastDay = y === e.y && m === e.m ? e.d : dim;
    const share = Math.max(0, lastDay - firstDay + 1) / dim;
    // Each month is charged in paise and the running totals add the rounded amounts, so the
    // months never sum to more than cost less salvage and the book value never goes below salvage.
    // Straight line charges what is due by the end of the month less what was charged, so the
    // paise do not drift and the last month of the life brings the book value to salvage.
    const left = round2(Math.max(0, cost - salvage - charged));
    if (left <= 0) break;
    elapsed += share;
    const raw = method === "slm" ? round2(slmMonthly * elapsed) - charged : (book * (asset.wdvRate! / 100) * share) / 12;
    const amount = round2(Math.min(raw, left));
    // A first or last month of a day or two can round to nothing: skip it, the rest still runs.
    if (amount <= 0) continue;
    charged = round2(charged + amount);
    book = round2(book - amount);
    out.push({ month: `${y}-${String(m + 1).padStart(2, "0")}`, amount });
  }
  return out;
}

/** Accumulated depreciation and book value at the end of `asOf`. */
export function bookValue(asset: DepreciableAsset, asOf: Date): { cost: number; accumulated: number; bookValue: number } {
  const purchased = new Date(asset.purchaseDate).getTime();
  if (purchased > asOf.getTime()) return { cost: 0, accumulated: 0, bookValue: 0 };
  const accumulated = round2(depreciationSchedule(asset, asOf).reduce((s, r) => s + r.amount, 0));
  const cost = round2(asset.purchaseCost || 0);
  return { cost, accumulated, bookValue: round2(cost - accumulated) };
}

/** Depreciation charged between two dates (both inclusive, IST days). */
export function depreciationBetween(asset: DepreciableAsset, from: Date, to: Date): number {
  const before = bookValue(asset, new Date(from.getTime() - 1)).accumulated;
  const upTo = bookValue(asset, to).accumulated;
  return round2(upTo - before);
}

/** Days between two instants, at least 1 (for spreading a prepaid expense). */
export const daysBetween = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / DAY) + 1);
