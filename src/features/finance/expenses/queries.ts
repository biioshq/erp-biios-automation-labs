import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, type ExpenseDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { getFiles } from "@/features/files/server";
import { salaryScope } from "@/server/auth/session";
import { dateRangeFilter } from "@/lib/dates";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import type { ExpenseCategory, ExpenseSource, PaymentMethod, ProjectStage } from "@/lib/constants";
import { totalTax } from "@/lib/gst";
import type { ExpenseDetail, ExpenseRow, ExpenseSummary } from "./types";

type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null;

type PopulatedRef = { _id: Types.ObjectId; name: string } | null;

/** A populated reference as { id, name }; null when unset or the target was deleted. */
function refOf(value: unknown): { id: string; name: string } | null {
  const r = value as PopulatedRef | undefined;
  return r?._id ? { id: String(r._id), name: r.name } : null;
}

function toRow(e: ExpenseDoc & { project?: unknown }): ExpenseRow {
  const project = e.project as PopulatedProject;
  return {
    id: String(e._id),
    number: e.number,
    vendor: e.vendor,
    description: e.description ?? null,
    category: e.category as ExpenseCategory,
    amount: e.amount,
    date: iso(e.date)!,
    paymentMethod: e.paymentMethod as PaymentMethod,
    project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? "#4a82cc" } : null,
    stage: (e.stage as ProjectStage | undefined) ?? null,
    source: (e.source ?? "manual") as ExpenseSource,
    gstin: e.gst?.gstin ?? null,
    invoiceNumber: e.gst?.invoiceNumber ?? null,
    totalTax: e.gst ? totalTax(e.gst) : 0,
    hasReceipt: Boolean(e.receipt),
    recurring: refOf(e.recurring),
    employee: refOf(e.employee),
  };
}

/** Mongo filter from list params. Exported so reports can reuse the same filtering. */
export function expenseFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">): QueryFilter<ExpenseDoc> {
  // Built loosely: Mongoose 9's strict filter types reject `$in` over string lists from the URL.
  const filter: Record<string, unknown> = {};
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    filter.$or = [{ vendor: re }, { description: re }, { number: re }, { "gst.invoiceNumber": re }, { "gst.gstin": re }, { notes: re }];
  }
  if (filters.category?.length) filter.category = { $in: filters.category };
  if (filters.stage?.length) filter.stage = { $in: filters.stage };
  if (filters.paymentMethod?.length) filter.paymentMethod = { $in: filters.paymentMethod };
  if (filters.source?.length) filter.source = { $in: filters.source };
  if (filters.vendor?.length) filter.vendor = { $in: filters.vendor };
  if (filters.project?.length) {
    const ids = filters.project.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const none = filters.project.includes("none");
    filter.project = none ? { $in: [...ids, null] } : { $in: ids };
  }
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.date = range;
  return filter as QueryFilter<ExpenseDoc>;
}

export async function listExpenses(params: ListParams): Promise<Paginated<ExpenseRow> & { summary: ExpenseSummary }> {
  await connectDB();
  const scope = await salaryScope();
  const filter = (Object.keys(scope).length ? { $and: [expenseFilter(params), scope] } : expenseFilter(params)) as ReturnType<typeof expenseFilter>;
  const [docs, total, summary] = await Promise.all([
    Expense.find(filter)
      .sort(mongoSort(params.sort ?? { id: "date", desc: true }))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate("project", "name code color")
      .populate("recurring", "name")
      .populate("employee", "name")
      .lean(),
    Expense.countDocuments(filter),
    Expense.aggregate<{ total: number; tax: number }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          tax: { $sum: { $add: [{ $ifNull: ["$gst.cgst", 0] }, { $ifNull: ["$gst.sgst", 0] }, { $ifNull: ["$gst.igst", 0] }, { $ifNull: ["$gst.cess", 0] }] } },
        },
      },
    ]),
  ]);
  return {
    rows: docs.map(toRow),
    total,
    page: params.page,
    pageSize: params.pageSize,
    summary: { count: total, total: summary[0]?.total ?? 0, tax: summary[0]?.tax ?? 0 },
  };
}

export async function getExpense(id: string): Promise<ExpenseDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const e = await Expense.findById(id)
    .populate("project", "name code color")
    .populate("item", "name sku")
    .populate("recurring", "name")
    .populate("employee", "name")
    .populate("createdBy", "name")
    .lean();
  if (!e) return null;
  if (e.category === "salaries" && Object.keys(await salaryScope()).length) return null;
  const [receipt] = e.receipt ? await getFiles([e.receipt]) : [null];
  const item = e.item as unknown as { _id: Types.ObjectId; name: string; sku: string } | null;
  const creator = e.createdBy as unknown as { _id: Types.ObjectId; name?: string } | null;
  const g = e.gst;
  return {
    ...toRow(e),
    vendorAddress: e.vendorAddress ?? null,
    notes: e.notes ?? null,
    gst: g
      ? {
          gstin: g.gstin ?? null,
          invoiceNumber: g.invoiceNumber ?? null,
          invoiceDate: iso(g.invoiceDate),
          taxableAmount: g.taxableAmount ?? 0,
          cgst: g.cgst ?? 0,
          sgst: g.sgst ?? 0,
          igst: g.igst ?? 0,
          cess: g.cess ?? 0,
          hsnSac: g.hsnSac ?? null,
          grandTotal: g.grandTotal ?? 0,
        }
      : null,
    receipt: receipt ?? null,
    ocr: e.ocr
      ? {
          overall: e.ocr.overall ?? 0,
          source: e.ocr.source ?? "",
          // lean() returns a Mongoose Map as a plain object.
          fields: (() => {
            const f = e.ocr.fields as unknown;
            if (f instanceof Map) return Object.fromEntries(f) as Record<string, number>;
            return { ...((f as Record<string, number> | undefined) ?? {}) };
          })(),
        }
      : null,
    item: item?._id ? { id: String(item._id), name: item.name, sku: item.sku } : null,
    quantity: e.quantity ?? null,
    unitCost: e.unitCost ?? null,
    createdBy: creator?._id ? { id: idOf(creator._id)!, name: creator.name ?? "" } : null,
    createdAt: iso(e.createdAt as Date)!,
    updatedAt: iso(e.updatedAt as Date)!,
  };
}
