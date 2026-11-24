import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { Income, Project, type IncomeDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { getFiles } from "@/features/files/server";
import { dateRangeFilter } from "@/lib/dates";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import type { IncomeCategory, PaymentMethod } from "@/lib/constants";
import type { IncomeDetail, IncomeRow, IncomeSummary } from "./types";

type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null;
type PopulatedInvoice = { _id: Types.ObjectId; number: string } | null;
type PopulatedAccount = { _id: Types.ObjectId; name: string } | null;

function toRow(i: IncomeDoc & { project?: unknown; invoice?: unknown; account?: unknown }): IncomeRow {
  const project = i.project as PopulatedProject;
  const invoice = i.invoice as PopulatedInvoice;
  const account = i.account as PopulatedAccount;
  return {
    id: String(i._id),
    number: i.number,
    client: i.client,
    category: i.category as IncomeCategory,
    amount: i.amount,
    date: iso(i.date)!,
    paymentMethod: i.paymentMethod as PaymentMethod,
    reference: i.reference ?? null,
    project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? "#4a82cc" } : null,
    hasReceipt: Boolean(i.receipt),
    invoice: invoice?._id ? { id: String(invoice._id), number: invoice.number } : null,
    account: account?._id ? { id: String(account._id), name: account.name } : null,
  };
}

/** Mongo filter from list params. Exported so reports can reuse the same filtering. */
export function incomeFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">): QueryFilter<IncomeDoc> {
  const filter: Record<string, unknown> = {};
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    filter.$or = [{ client: re }, { number: re }, { reference: re }, { notes: re }];
  }
  if (filters.category?.length) filter.category = { $in: filters.category };
  if (filters.paymentMethod?.length) filter.paymentMethod = { $in: filters.paymentMethod };
  if (filters.project?.length) {
    const ids = filters.project.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const none = filters.project.includes("none");
    filter.project = none ? { $in: [...ids, null] } : { $in: ids };
  }
  // Both values together, or neither, means no filter.
  const inv = filters.invoice ?? [];
  if (inv.includes("linked") !== inv.includes("unlinked")) filter.invoice = inv.includes("linked") ? { $ne: null } : null;
  const range = dateRangeFilter(params.from, params.to);
  if (range) filter.date = range;
  return filter as QueryFilter<IncomeDoc>;
}

export async function listIncome(params: ListParams): Promise<Paginated<IncomeRow> & { summary: IncomeSummary }> {
  await connectDB();
  const filter = incomeFilter(params);
  const [docs, total, summary] = await Promise.all([
    Income.find(filter)
      .sort(mongoSort(params.sort ?? { id: "date", desc: true }))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate("project", "name code color")
      .populate("invoice", "number")
      .populate("account", "name")
      .lean(),
    Income.countDocuments(filter),
    Income.aggregate<{ total: number }>([{ $match: filter }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);
  return {
    rows: docs.map(toRow),
    total,
    page: params.page,
    pageSize: params.pageSize,
    summary: { count: total, total: summary[0]?.total ?? 0 },
  };
}

export async function getIncome(id: string): Promise<IncomeDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const i = await Income.findById(id)
    .populate("project", "name code color")
    .populate("invoice", "number")
    .populate("account", "name")
    .populate("createdBy", "name")
    .lean();
  if (!i) return null;
  const [receipt] = i.receipt ? await getFiles([i.receipt]) : [null];
  const creator = i.createdBy as unknown as { _id: Types.ObjectId; name?: string } | null;
  return {
    ...toRow(i),
    notes: i.notes ?? null,
    receipt: receipt ?? null,
    fromBankStatement: Boolean(i.bankTransaction),
    bankTransactionId: i.bankTransaction ? String(i.bankTransaction) : null,
    createdBy: creator?._id ? { id: idOf(creator._id)!, name: creator.name ?? "" } : null,
    createdAt: iso(i.createdAt as Date)!,
    updatedAt: iso(i.updatedAt as Date)!,
  };
}

/** Known client names (income records and projects), most used first. */
export async function getClientNames(limit = 300): Promise<string[]> {
  await connectDB();
  const [fromIncome, fromProjects] = await Promise.all([
    Income.aggregate<{ _id: string }>([{ $group: { _id: "$client", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: limit }]),
    Project.distinct("client"),
  ]);
  return [...new Set([...fromIncome.map((c) => c._id), ...(fromProjects as string[])].filter(Boolean))];
}
