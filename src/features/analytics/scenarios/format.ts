import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { fromDateInput } from "@/lib/dates";
import type { Cell, ValueType } from "./types";

/** One cell of a scenario result as text: rupees, numbers with their unit, percentages, IST days. Client-safe. */
export function formatCell(type: ValueType, value: Cell, unit?: string, signed = false): string {
  if (value === null || value === undefined || value === "") return "Not known";
  if (typeof value === "string") return type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(fromDateInput(value)) : value;
  const sign = signed && value > 0 ? "+" : "";
  if (type === "money") return `${sign}${formatCurrency(value)}`;
  // A difference of two percentages is in percentage points.
  if (type === "percent") return signed ? `${sign}${(value * 100).toFixed(1)} pts` : `${(value * 100).toFixed(1)}%`;
  return `${sign}${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}
