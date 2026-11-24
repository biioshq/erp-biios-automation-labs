import { MAJOR_DEVIATION } from "./constants";
import type { AccuracyRow } from "./types";

/** Small client-safe helpers shared by the forecasting pages and components. */

/** True when a stored forecast was off by more than the major-difference share of itself. */
export const isMajorDifference = (r: Pick<AccuracyRow, "deviation">) => Math.abs(r.deviation) > MAJOR_DEVIATION;

/** "1 item" / "3 items" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "12.5 pcs" */
export const formatQty = (value: number, unit?: string | null) => `${qtyFmt.format(value)}${unit ? ` ${unit}` : ""}`;

/** "12.5 pcs/day" or a dash without a rate. */
export const formatRate = (perDay: number | null, unit: string) => (perDay ? `${qtyFmt.format(perDay)} ${unit}/day` : "-");
