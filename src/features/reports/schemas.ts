import { z } from "zod";
import {
  DEPARTMENTS,
  EXPENSE_NATURES,
  PAYMENT_STATUSES,
  REPORT_FORMATS,
  REPORT_TYPES,
  valuesOf,
  type ReportFormat,
  type ReportType,
} from "@/lib/constants";
import { isLegacyReport, reportInfo } from "./catalog";
import type { PlColumns, ReportFilters } from "./types";

/** Client-safe: parses and writes the report URL contract (/api/reports/<type>?format=…&from=…). */

const csvList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : []));
/** A list limited to known values, so the subtitle and the export log never name a filter that was not applied. */
const knownList = (allowed: readonly string[]) => csvList.transform((v) => v.filter((x) => allowed.includes(x)));
const day = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));
export const PL_COLUMN_OPTIONS: { value: PlColumns; label: string }[] = [
  { value: "total", label: "Total" },
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
];
const plColumns = z
  .string()
  .optional()
  .transform((v): PlColumns | undefined => PL_COLUMN_OPTIONS.find((o) => o.value === v)?.value);
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
  /** Customer statement: customer names. */
  customer: csvList,
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
  columns: plColumns,
  /** Expense list passthrough filters (the expense report only). */
  status: knownList(valuesOf(PAYMENT_STATUSES)),
  nature: knownList(valuesOf(EXPENSE_NATURES)),
  department: knownList(["none", ...valuesOf(DEPARTMENTS)]),
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
  if (isLegacyReport(type)) {
    // Payment status, direct / indirect and department narrow the expense report only.
    const expenseOnly = { status: [], nature: [], department: [] };
    if (type === "expense") return filters;
    if (type !== "ca") return { ...filters, ...expenseOnly };
    return { ...filters, ...expenseOnly, q: "", stage: [], paymentMethod: [], source: [], movementType: [], item: [], movements: false };
  }
  // The newer reports keep only what their filter bar offers. An as-of report keeps its day in `to`.
  const keys = reportInfo(type)?.filters ?? [];
  const has = (k: (typeof keys)[number]) => keys.includes(k);
  return {
    from: has("date") ? filters.from : null,
    to: has("date") || has("asOf") ? filters.to : null,
    project: has("project") ? filters.project : [],
    vendor: has("vendor") ? filters.vendor : [],
    ...(has("customer") ? { customer: filters.customer ?? [] } : {}),
    category: [],
    movements: false,
    q: "",
    stage: [],
    paymentMethod: [],
    source: [],
    movementType: [],
    item: [],
    ...(has("columns") ? { columns: filters.columns ?? "total" } : {}),
  };
}


/** Parses a download request. `ok: false` carries the first problem in words. */
export function parseReportRequest(type: string, sp: URLSearchParams) {
  const t = reportTypeSchema.safeParse(type);
  if (!t.success) return { ok: false as const, error: "Unknown report type." };
  // A what-if scenario is exported from its own page, with the scenario it belongs to.
  if (t.data === "scenario") return { ok: false as const, error: "What-if scenarios are exported from the scenario page, not as a report." };
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
    ["customer", filters.customer],
    ["category", filters.category],
    ["stage", filters.stage],
    ["paymentMethod", filters.paymentMethod],
    ["source", filters.source],
    ["type", filters.movementType],
    ["item", filters.item],
    ["status", filters.status],
    ["nature", filters.nature],
    ["department", filters.department],
  ];
  for (const [key, values] of lists) if (values?.length) p.set(key, values.join(","));
  if (filters.q) p.set("q", filters.q);
  if (filters.movements) p.set("movements", "1");
  if (filters.columns && filters.columns !== "total") p.set("columns", filters.columns);
  return p.toString();
}

export function reportHref(type: ReportType, format: ReportFormat, filters: Partial<ReportFilters>) {
  return `/api/reports/${type}?${reportQueryString(filters, format)}`;
}
