import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryCategory, InventoryItem, Project } from "@/server/models";
import { dateRangeFilter, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import { DEPARTMENTS, EXPENSE_NATURES, EXPENSE_SOURCES, INCOME_CATEGORIES, MOVEMENT_TYPES, PAYMENT_METHODS, PAYMENT_STATUSES, PROJECT_STAGES, labelOf } from "@/lib/constants";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import type { ReportColumn, ReportFilters, ReportRow, ReportTotals, ColumnType } from "../types";

export const col = (key: string, header: string, type: ColumnType, width: number): ReportColumn => ({ key, header, type, width });

/**
 * Sums the money (and optionally other numeric) columns into a totals row; `label` goes in the first text column.
 * `only` limits the sum to those column keys, for tables where some money columns (unit costs) mean nothing added up.
 */
export function sumTotals(
  columns: ReportColumn[],
  rows: ReportRow[],
  label = "Total",
  types: ColumnType[] = ["money"],
  only?: string[],
): ReportTotals {
  const totals: ReportTotals = {};
  let labelled = false;
  for (const c of columns) {
    if (types.includes(c.type) && (!only || only.includes(c.key))) {
      let sum = 0;
      for (const r of rows) {
        if (r._kind === "subtotal") continue;
        const v = r[c.key];
        if (typeof v === "number") sum += v;
      }
      totals[c.key] = round2(sum);
    } else if (!labelled && c.type === "text") {
      totals[c.key] = label;
      labelled = true;
    }
  }
  return totals;
}

export const objectIds = (values: string[]) => values.filter((v) => Types.ObjectId.isValid(v)).map((v) => new Types.ObjectId(v));

/** "yyyy-mm-dd" bounds as Mongo range (IST days, both inclusive). */
export const rangeOf = (f: Pick<ReportFilters, "from" | "to">) => dateRangeFilter(f.from, f.to);

/**
 * Whether the period is whole IST months: it starts on the 1st (or has no start) and ends on the last day
 * of a month, today or later (or has no end). Members see the company salary total only for such periods,
 * the same view the dashboard gives. A total over a few days could be one person's pay, and two
 * part-month totals could be subtracted to isolate one payment.
 */
export function coversWholeMonths(f: Pick<ReportFilters, "from" | "to">, today = toDateInput(new Date())): boolean {
  if (f.from && !f.from.endsWith("-01")) return false;
  if (!f.to || f.to >= today) return true;
  const [y, m] = f.to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(f.to.slice(8, 10)) === lastDay;
}

export function periodText(f: Pick<ReportFilters, "from" | "to">): string {
  if (f.from && f.to) return `${formatDate(fromDateInput(f.from))} to ${formatDate(fromDateInput(f.to))}`;
  if (f.from) return `From ${formatDate(fromDateInput(f.from))}`;
  if (f.to) return `Up to ${formatDate(fromDateInput(f.to))}`;
  return "All dates";
}

async function projectNames(ids: string[]): Promise<string[]> {
  const valid = objectIds(ids);
  const names = valid.length ? await Project.find({ _id: { $in: valid } }, { name: 1 }).lean() : [];
  const out = names.map((p) => p.name);
  if (ids.includes("none")) out.push("No project");
  return out;
}

const list = (values: string[], max = 4) =>
  values.length > max ? `${values.slice(0, max).join(", ")} and ${values.length - max} more` : values.join(", ");

/** The period and filters in words, for the report subtitle. */
export async function describeFilters(
  f: ReportFilters,
  opts: {
    period?: boolean;
    categories?: "expense" | "income" | "inventory" | null;
    vendor?: boolean;
    project?: boolean;
    /** The list filters this report applies, named in the subtitle so a filtered file says so. */
    passthrough?: ("stage" | "paymentMethod" | "source" | "movementType" | "item" | "status" | "nature" | "department")[];
  } = {},
): Promise<string> {
  await connectDB();
  const parts: string[] = [];
  if (opts.period !== false) parts.push(`Period: ${periodText(f)}`);
  if (opts.project !== false && f.project.length) parts.push(`Projects: ${list(await projectNames(f.project))}`);
  if (opts.vendor !== false && f.vendor.length) parts.push(`Vendors: ${list(f.vendor)}`);
  if (f.category.length && opts.categories) {
    if (opts.categories === "inventory") {
      const cats = await InventoryCategory.find({ _id: { $in: objectIds(f.category) } }, { name: 1 }).lean();
      parts.push(`Categories: ${list(cats.map((c) => c.name))}`);
    } else {
      const label = opts.categories === "income" ? (c: string) => labelOf(INCOME_CATEGORIES, c as never) : await getExpenseCategoryLabeler();
      parts.push(`Categories: ${list(f.category.map((c) => label(c)))}`);
    }
  }
  const pass = new Set(opts.passthrough ?? []);
  const named = <T extends string>(options: readonly { value: T; label: string }[], values: string[]) => list(values.map((v) => labelOf(options, v as T)));
  if (pass.has("stage") && f.stage.length) parts.push(`Stage: ${named(PROJECT_STAGES, f.stage)}`);
  if (pass.has("paymentMethod") && f.paymentMethod.length) parts.push(`Payment: ${named(PAYMENT_METHODS, f.paymentMethod)}`);
  if (pass.has("source") && f.source.length) parts.push(`Source: ${named(EXPENSE_SOURCES, f.source)}`);
  if (pass.has("movementType") && f.movementType.length) parts.push(`Type: ${named(MOVEMENT_TYPES, f.movementType)}`);
  if (pass.has("status") && f.status?.length) parts.push(`Payment status today: ${named(PAYMENT_STATUSES, f.status)}`);
  if (pass.has("nature") && f.nature?.length) parts.push(`Nature: ${named(EXPENSE_NATURES, f.nature)}`);
  if (pass.has("department") && f.department?.length) {
    parts.push(`Department: ${list(f.department.map((d) => (d === "none" ? "No department" : labelOf(DEPARTMENTS, d as (typeof DEPARTMENTS)[number]["value"]))))}`);
  }
  if (pass.has("item") && f.item.length) {
    const items = await InventoryItem.find({ _id: { $in: objectIds(f.item) } }, { name: 1 }).lean();
    parts.push(`Items: ${list(items.map((i) => i.name))}`);
  }
  if (f.q) parts.push(`Search: "${f.q}"`);
  return parts.join(" · ");
}

/** Project filter for a model with a `project` field. "none" matches records with no project. */
export function projectMatch(values: string[]): Record<string, unknown> | null {
  if (!values.length) return null;
  const ids = objectIds(values);
  return { $in: values.includes("none") ? [...ids, null] : ids };
}

export const day = (d: Date | string | null | undefined): string | null => toDateInput(d) || null;

export const taxOf = (g?: { cgst?: number | null; sgst?: number | null; igst?: number | null; cess?: number | null } | null) =>
  round2((g?.cgst ?? 0) + (g?.sgst ?? 0) + (g?.igst ?? 0) + (g?.cess ?? 0));
