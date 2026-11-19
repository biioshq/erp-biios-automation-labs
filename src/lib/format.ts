/**
 * Formatting for money, numbers and dates. Client-safe.
 * Money is Indian rupees with lakh/crore grouping (₹3,50,000); dates are shown in IST.
 */

export const TIME_ZONE = "Asia/Kolkata";

const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });

/** ₹3,50,000 or ₹1,234.50: whole rupees when there are no paise, otherwise two decimals. */
export function formatCurrency(value: number | null | undefined, options?: { exact?: boolean; whole?: boolean }) {
  const v = value ?? 0;
  if (options?.exact) return inrExact.format(v);
  if (options?.whole) return inrWhole.format(v);
  return Number.isInteger(round2(v)) ? inrWhole.format(v) : inrExact.format(v);
}

/** Short form for KPIs and chart axes: ₹950, ₹12.4K, ₹3.5L, ₹1.2Cr */
export function formatCompactCurrency(value: number | null | undefined) {
  const v = value ?? 0;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${trim(a)}`;
}

function trim(n: number) {
  return n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, "");
}

export function formatNumber(value: number | null | undefined) {
  return num.format(value ?? 0);
}

/** 0.256 → 25.6% */
export function formatPercent(ratio: number | null | undefined) {
  return pct.format(Number.isFinite(ratio ?? NaN) ? (ratio as number) : 0);
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TIME_ZONE });
const dateShortFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TIME_ZONE });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: TIME_ZONE });

type DateInput = Date | string | number | null | undefined;
const toDate = (d: DateInput) => (d === null || d === undefined || d === "" ? null : new Date(d));

/** 19 Nov 2026 */
export function formatDate(d: DateInput) {
  const date = toDate(d);
  return date && !Number.isNaN(date.getTime()) ? dateFmt.format(date) : "Not set";
}

/** 19 Nov */
export function formatDateShort(d: DateInput) {
  const date = toDate(d);
  return date && !Number.isNaN(date.getTime()) ? dateShortFmt.format(date) : "Not set";
}

/** 19 Nov 2026, 1:06 pm */
export function formatDateTime(d: DateInput) {
  const date = toDate(d);
  return date && !Number.isNaN(date.getTime()) ? dateTimeFmt.format(date) : "Not set";
}

/** Nov 26 */
export function formatMonth(d: DateInput) {
  const date = toDate(d);
  return date && !Number.isNaN(date.getTime()) ? monthFmt.format(date) : "Not set";
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago", "in 2 days" */
export function formatRelative(d: DateInput, now: Date = new Date()) {
  const date = toDate(d);
  if (!date) return "Not set";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(seconds / (86400 * 30)), "month");
  return rtf.format(Math.round(seconds / (86400 * 365)), "year");
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Initials for avatars: "Aarav Mehta" → "AM", "Biios Automation Labs" → "BA" */
export function initials(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Round money to paise. Every amount is rounded on write. */
export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
