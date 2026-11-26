import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, FixedAsset, type ExpenseDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { getFiles } from "@/features/files/server";
import { salaryScope } from "@/server/auth/session";
import { dateRangeFilter } from "@/lib/dates";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { DEPARTMENTS, valuesOf, type Department, type ExpenseNature, type ExpenseSource, type PaymentMethod, type PaymentStatus, type ProjectStage } from "@/lib/constants";
import { getExpenseCategories } from "@/server/expense-categories";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  categoryNature,
  directCategoryValues,
  expenseCategoryLabel,
  type ExpenseCategoryOption,
} from "@/lib/expense-categories";
import { expenseNature } from "@/lib/expense-nature";
import { effectivePayments, paymentState } from "@/lib/payments";
import { totalTax } from "@/lib/gst";
import { round2 } from "@/lib/format";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { EXPENSE_NATURE_FILTER_VALUES, EXPENSE_STATUS_FILTER_VALUES } from "./schemas";
import { OUTSTANDING_EXPR, PAID_EXPR, statusCondition } from "./payment-status";
import { HALF_PAISA } from "./server";
import type { ExpenseDetail, ExpensePaymentRecord, ExpensePaymentSummary, ExpenseRow, ExpenseSummary } from "./types";

const DEPARTMENT_VALUES = valuesOf(DEPARTMENTS);

type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null;

type PopulatedRef = { _id: Types.ObjectId; name: string } | null;

/** A populated reference as { id, name }; null when unset or the target was deleted. */
function refOf(value: unknown): { id: string; name: string } | null {
  const r = value as PopulatedRef | undefined;
  return r?._id ? { id: String(r._id), name: r.name } : null;
}

/** What toRow needs to know about categories: names and direct/indirect settings. */
type CategoryLookup = { label: (value: string | null | undefined) => string; nature: (value: string) => ExpenseNature };

function categoryLookup(categories: readonly ExpenseCategoryOption[]): CategoryLookup {
  return { label: (v) => expenseCategoryLabel(categories, v), nature: (v) => categoryNature(categories, v) };
}

/** Paid and outstanding as of `now`. Generated stock assignments move no money, so they show "stock". */
export function paymentSummaryOf(e: Pick<ExpenseDoc, "amount" | "date" | "paymentMethod" | "dueDate" | "payments" | "account">, now = new Date()): ExpensePaymentSummary {
  const explicit = Array.isArray(e.payments);
  const like = { amount: e.amount, date: e.date, paymentMethod: e.paymentMethod, dueDate: e.dueDate, payments: e.payments };
  const s = paymentState(like, now);
  const stock = !explicit && e.paymentMethod === "stock";
  // The latest payment (the same list paymentState reads); on a tie the one recorded last.
  const last = effectivePayments(like).reduce<{ date: Date; paymentMethod: string } | null>((best, p) => {
    const d = new Date(p.date);
    return !best || d.getTime() >= best.date.getTime() ? { date: d, paymentMethod: String(p.paymentMethod) } : best;
  }, null);
  return {
    status: stock ? "stock" : s.status,
    paid: s.paid,
    outstanding: s.outstanding,
    dueOn: s.dueOn ? iso(s.dueOn) : null,
    explicit,
    lastPaidOn: !stock && s.lastPaidOn ? iso(s.lastPaidOn) : null,
    lastMethod: !stock && last ? (last.paymentMethod as PaymentMethod) : null,
  };
}

/** Came from, or was paid through, a bank statement line (the expense's own link, or any payment's). */
export const FROM_BANK_STATEMENT = {
  $or: [{ bankTransaction: { $type: "objectId" } }, { payments: { $elemMatch: { bankTransaction: { $type: "objectId" } } } }],
} as const;

function fromBank(e: { bankTransaction?: unknown; payments?: { bankTransaction?: unknown }[] | null }): boolean {
  return Boolean(e.bankTransaction) || (e.payments ?? []).some((p) => Boolean(p.bankTransaction));
}

function toRow(e: ExpenseDoc & { project?: unknown }, categories: CategoryLookup, now = new Date()): ExpenseRow {
  const project = e.project as PopulatedProject;
  return {
    id: String(e._id),
    number: e.number,
    vendor: e.vendor,
    description: e.description ?? null,
    category: e.category,
    categoryLabel: categories.label(e.category),
    amount: e.amount,
    date: iso(e.date)!,
    paymentMethod: e.paymentMethod as PaymentMethod,
    project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? "#4a82cc" } : null,
    stage: (e.stage as ProjectStage | undefined) ?? null,
    source: (e.source ?? "manual") as ExpenseSource,
    countedAtPurchase: e.countedAtPurchase === true,
    gstin: e.gst?.gstin ?? null,
    invoiceNumber: e.gst?.invoiceNumber ?? null,
    totalTax: e.gst ? totalTax(e.gst) : 0,
    hasReceipt: Boolean(e.receipt),
    recurring: refOf(e.recurring),
    employee: refOf(e.employee),
    department: (e.department as Department | undefined) ?? null,
    nature: expenseNature({ category: e.category, project: e.project }, categories.nature(e.category)),
    payment: paymentSummaryOf(e, now),
    dueDate: iso(e.dueDate ?? null),
    fromBank: fromBank(e),
  };
}

type FilterOptions = {
  /**
   * Categories set to direct, for the nature filter (directCategoryValues of getExpenseCategories).
   * Without it the built-in defaults apply; expenseListFilter passes the admins' settings.
   */
  directCategories?: readonly string[];
  /** "Today" for the status filter. */
  now?: Date;
};

/** Direct: on a project, or a direct category. Indirect: neither. Both or neither selected: no condition. */
function natureCondition(natures: string[], directCategories: readonly string[]): Record<string, unknown> | null {
  const wanted = natures.filter((n) => (EXPENSE_NATURE_FILTER_VALUES as readonly string[]).includes(n));
  if (wanted.length !== 1) return null;
  const direct = [...directCategories];
  return wanted[0] === "direct"
    ? { $or: [{ project: { $ne: null } }, { category: { $in: direct } }] }
    : { project: null, category: { $nin: direct } };
}

/**
 * Mongo filter from list params. Exported so reports can reuse the same filtering. The status
 * filter follows paymentState (payment-status.ts); the nature filter needs the category settings
 * (see FilterOptions), so lists use expenseListFilter.
 */
export function expenseFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">, options: FilterOptions = {}): QueryFilter<ExpenseDoc> {
  // Built loosely: Mongoose 9's strict filter types reject `$in` over string lists from the URL.
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
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
  // Unknown values from a hand-edited URL are ignored, as the report parser does, so the list and its export agree.
  const departments = (filters.department ?? []).filter((d) => d === "none" || (DEPARTMENT_VALUES as readonly string[]).includes(d));
  if (departments.length) {
    const named = departments.filter((d) => d !== "none");
    filter.department = departments.includes("none") ? { $in: [...named, null] } : { $in: named };
  }
  const statuses = (filters.status ?? []).filter((s): s is PaymentStatus => (EXPENSE_STATUS_FILTER_VALUES as readonly string[]).includes(s));
  if (statuses.length) and.push(statusCondition(statuses, options.now));
  if (filters.bank?.includes("yes")) and.push(FROM_BANK_STATEMENT);
  if (filters.nature?.length) {
    const direct = options.directCategories ?? directCategoryValues(DEFAULT_EXPENSE_CATEGORIES);
    const condition = natureCondition(filters.nature, direct);
    if (condition) and.push(condition);
  }
  if (and.length) filter.$and = and;
  return filter as QueryFilter<ExpenseDoc>;
}

/** expenseFilter with the admins' direct/indirect settings, for lists and summaries. */
export async function expenseListFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">, now = new Date()): Promise<QueryFilter<ExpenseDoc>> {
  const categories = await getExpenseCategories();
  return expenseFilter(params, { directCategories: directCategoryValues(categories), now });
}

/**
 * The Total expenses list with its header figures. `options.where` narrows it to a view of its own
 * (Fixed payments lists one-off purchases of goods this way), with the same rows and totals.
 */
export async function listExpenses(
  params: ListParams,
  options: { where?: Record<string, unknown> } = {},
): Promise<Paginated<ExpenseRow> & { summary: ExpenseSummary }> {
  await connectDB();
  const now = new Date();
  const [scope, base, categories] = await Promise.all([salaryScope(), expenseListFilter(params, now), getExpenseCategories()]);
  const parts = [base, ...(Object.keys(scope).length ? [scope] : []), ...(options.where ? [options.where] : [])];
  const filter = (parts.length > 1 ? { $and: parts } : base) as typeof base;
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
    // Totals leave out stock counted at purchase, whatever the filter: the purchase itself is
    // already in them. Project spend and the project's expenses tab count it.
    // Paid and outstanding use the expressions the status filters use (payment-status.ts), so the
    // header agrees with every row's status. Paid is capped at the amount, so paid + from stock + outstanding = total.
    Expense.aggregate<{ total: number; tax: number; paid: number; fromStock: number; outstanding: number; outstandingCount: number }>([
      { $match: { $and: [filter, COMPANY_EXPENSES] } },
      { $addFields: { _outstanding: OUTSTANDING_EXPR } },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          tax: { $sum: { $add: [{ $ifNull: ["$gst.cgst", 0] }, { $ifNull: ["$gst.sgst", 0] }, { $ifNull: ["$gst.igst", 0] }, { $ifNull: ["$gst.cess", 0] }] } },
          // Stock used from inventory moves no money: it is shown apart from what was paid.
          paid: { $sum: { $cond: [{ $eq: ["$paymentMethod", "stock"] }, 0, { $min: ["$amount", PAID_EXPR] }] } },
          fromStock: { $sum: { $cond: [{ $eq: ["$paymentMethod", "stock"] }, { $min: ["$amount", PAID_EXPR] }, 0] } },
          outstanding: { $sum: "$_outstanding" },
          outstandingCount: { $sum: { $cond: [{ $gt: ["$_outstanding", HALF_PAISA] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const lookup = categoryLookup(categories);
  return {
    rows: docs.map((d) => toRow(d, lookup, now)),
    total,
    page: params.page,
    pageSize: params.pageSize,
    // Rounded to paise: a float sum depends on the order the database adds the rows in.
    summary: {
      count: total,
      total: round2(summary[0]?.total ?? 0),
      tax: round2(summary[0]?.tax ?? 0),
      paid: round2(summary[0]?.paid ?? 0),
      fromStock: round2(summary[0]?.fromStock ?? 0),
      outstanding: round2(summary[0]?.outstanding ?? 0),
      outstandingCount: summary[0]?.outstandingCount ?? 0,
    },
  };
}

/** Rows for the given expenses, in the order given (pages that select ids by aggregation). */
export async function expenseRowsByIds(ids: Types.ObjectId[], now = new Date()): Promise<ExpenseRow[]> {
  if (!ids.length) return [];
  await connectDB();
  const [docs, categories] = await Promise.all([
    Expense.find({ _id: { $in: ids } })
      .populate("project", "name code color")
      .populate("recurring", "name")
      .populate("employee", "name")
      .lean(),
    getExpenseCategories(),
  ]);
  const lookup = categoryLookup(categories);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.flatMap((id) => {
    const d = byId.get(String(id));
    return d ? [toRow(d, lookup, now)] : [];
  });
}

type PopulatedPayment = {
  _id: Types.ObjectId;
  date: Date;
  amount: number;
  paymentMethod: string;
  account?: PopulatedRef | Types.ObjectId | null;
  reference?: string | null;
  note?: string | null;
  bankTransaction?: Types.ObjectId | null;
  createdBy?: PopulatedRef | Types.ObjectId | null;
  createdAt?: Date | null;
};

function toPaymentRecord(p: PopulatedPayment): ExpensePaymentRecord {
  return {
    id: String(p._id),
    date: iso(p.date)!,
    amount: p.amount,
    paymentMethod: p.paymentMethod as PaymentMethod,
    account: refOf(p.account),
    reference: p.reference ?? null,
    note: p.note ?? null,
    fromBankStatement: Boolean(p.bankTransaction),
    bankTransactionId: p.bankTransaction ? String(p.bankTransaction) : null,
    createdBy: refOf(p.createdBy),
    createdAt: iso(p.createdAt ?? null),
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
    .populate("account", "name")
    .populate("payments.account", "name")
    .populate("payments.createdBy", "name")
    .populate("liability", "name")
    .populate("capitalAsset", "name code purchaseCost")
    .lean();
  if (!e) return null;
  // An asset bought through this expense: by the expense's link, or by the asset's funding (older records).
  type AssetRef = { _id: Types.ObjectId; name: string; code: string; purchaseCost: number } | null;
  const asset = ((e.capitalAsset as unknown as AssetRef)?._id
    ? e.capitalAsset
    : await FixedAsset.findOne({ "funding.expense": e._id }, { name: 1, code: 1, purchaseCost: 1 }).lean()) as unknown as AssetRef;
  if (e.category === "salaries" && Object.keys(await salaryScope()).length) return null;
  const [[receipt], categories] = await Promise.all([e.receipt ? getFiles([e.receipt]) : Promise.resolve([null]), getExpenseCategories()]);
  const item = e.item as unknown as { _id: Types.ObjectId; name: string; sku: string } | null;
  const creator = e.createdBy as unknown as { _id: Types.ObjectId; name?: string } | null;
  const payments = ((e.payments ?? []) as unknown as PopulatedPayment[]).map(toPaymentRecord).sort((a, b) => a.date.localeCompare(b.date));
  const g = e.gst;
  return {
    ...toRow(e, categoryLookup(categories)),
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
    dueDate: iso(e.dueDate ?? null),
    account: refOf(e.account),
    payments,
    prepaid: e.prepaid?.from && e.prepaid?.to ? { from: iso(e.prepaid.from)!, to: iso(e.prepaid.to)! } : null,
    liability: refOf(e.liability),
    capitalAsset: asset?._id ? { id: String(asset._id), name: asset.name, code: asset.code, purchaseCost: asset.purchaseCost } : null,
    bankMatched: !Array.isArray(e.payments) && Boolean(e.bankTransaction),
    bankTransactionId: e.bankTransaction ? String(e.bankTransaction) : null,
  };
}
