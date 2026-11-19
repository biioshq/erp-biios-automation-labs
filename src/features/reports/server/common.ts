import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { InventoryCategory, Project } from "@/server/models";
import { dateRangeFilter, fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate, round2 } from "@/lib/format";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, labelOf } from "@/lib/constants";
import type { ReportColumn, ReportFilters, ReportRow, ReportTotals, ColumnType } from "../types";

export const col = (key: string, header: string, type: ColumnType, width: number): ReportColumn => ({ key, header, type, width });

/** Sums the money (and optionally other numeric) columns into a totals row; `label` goes in the first text column. */
export function sumTotals(columns: ReportColumn[], rows: ReportRow[], label = "Total", types: ColumnType[] = ["money"]): ReportTotals {
  const totals: ReportTotals = {};
  let labelled = false;
  for (const c of columns) {
    if (types.includes(c.type)) {
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
  opts: { period?: boolean; categories?: "expense" | "income" | "inventory" | null; vendor?: boolean; project?: boolean } = {},
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
      const dict = opts.categories === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      parts.push(`Categories: ${list(f.category.map((c) => labelOf(dict, c as never)))}`);
    }
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
