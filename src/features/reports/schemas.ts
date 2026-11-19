import { z } from "zod";
import { REPORT_FORMATS, REPORT_TYPES, valuesOf, type ReportFormat, type ReportType } from "@/lib/constants";
import type { ReportFilters } from "./types";

/** Client-safe: parses and writes the report URL contract (/api/reports/<type>?format=…&from=…). */

const csvList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : []));
const day = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));
const flag = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

export const reportTypeSchema = z.enum(valuesOf(REPORT_TYPES));
export const reportFormatSchema = z.enum(valuesOf(REPORT_FORMATS));

const filtersSchema = z.object({
  from: day,
  to: day,
  project: csvList,
  vendor: csvList,
  category: csvList,
  movements: flag,
  q: z
    .string()
    .optional()
    .transform((v) => (v ?? "").trim().slice(0, 100)),
  stage: csvList,
  paymentMethod: csvList,
  source: csvList,
  type: csvList,
  item: csvList,
});

export const reportQuerySchema = filtersSchema.extend({ format: reportFormatSchema.default("pdf") });

/** Joins repeated and comma-separated values: ?project=a,b&project=c → "a,b,c". */
function flatten(sp: URLSearchParams | Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  const keys = sp instanceof URLSearchParams ? [...new Set(sp.keys())] : Object.keys(sp);
  for (const key of keys) {
    const values = sp instanceof URLSearchParams ? sp.getAll(key) : ([] as (string | undefined)[]).concat(sp[key]);
    out[key] = values.filter(Boolean).join(",");
  }
  return out;
}

export function parseReportFilters(sp: URLSearchParams | Record<string, string | string[] | undefined>): ReportFilters {
  const parsed = filtersSchema.parse(flatten(sp));
  const { type, ...rest } = parsed;
  return { ...rest, movementType: type };
}

/**
 * Drops the filters a report does not offer, so the file, its export log entry and "Download again" all
 * describe the same data. The CA pack offers only date, project, vendor and category: a hand-edited
 * ?paymentMethod= or ?q= would otherwise narrow its registers but not its vendor totals or salary line.
 */
export function filtersForReport(type: ReportType, filters: ReportFilters): ReportFilters {
  if (type !== "ca") return filters;
  return { ...filters, q: "", stage: [], paymentMethod: [], source: [], movementType: [], item: [], movements: false };
}

/** Parses a download request. `ok: false` carries the first problem in words. */
export function parseReportRequest(type: string, sp: URLSearchParams) {
  const t = reportTypeSchema.safeParse(type);
  if (!t.success) return { ok: false as const, error: "Unknown report type." };
  const q = reportQuerySchema.safeParse(flatten(sp));
  if (!q.success) {
    const issue = q.error.issues[0];
    return { ok: false as const, error: `Invalid ${issue?.path.join(".") || "request"}: ${issue?.message ?? "check the parameters"}.` };
  }
  const { format, type: movementType, ...rest } = q.data;
  const filters = filtersForReport(t.data as ReportType, { ...rest, movementType });
  if (filters.from && filters.to && filters.from > filters.to) {
    return { ok: false as const, error: "The start date is after the end date." };
  }
  return { ok: true as const, type: t.data as ReportType, format: format as ReportFormat, filters };
}

/** Query string for a report URL, only with the values that are set. */
export function reportQueryString(filters: Partial<ReportFilters>, format?: ReportFormat) {
  const p = new URLSearchParams();
  if (format) p.set("format", format);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  const lists: [string, string[] | undefined][] = [
    ["project", filters.project],
    ["vendor", filters.vendor],
    ["category", filters.category],
    ["stage", filters.stage],
    ["paymentMethod", filters.paymentMethod],
    ["source", filters.source],
    ["type", filters.movementType],
    ["item", filters.item],
  ];
  for (const [key, values] of lists) if (values?.length) p.set(key, values.join(","));
  if (filters.q) p.set("q", filters.q);
  if (filters.movements) p.set("movements", "1");
  return p.toString();
}

export function reportHref(type: ReportType, format: ReportFormat, filters: Partial<ReportFilters>) {
  return `/api/reports/${type}?${reportQueryString(filters, format)}`;
}
