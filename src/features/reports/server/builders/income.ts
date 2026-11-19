import "server-only";

import { connectDB } from "@/server/db";
import { Income } from "@/server/models";
import { INCOME_CATEGORIES, PAYMENT_METHODS, labelOf, type IncomeCategory, type PaymentMethod } from "@/lib/constants";
import { searchRegex } from "@/lib/list-params";
import { col, day, describeFilters, projectMatch, rangeOf, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow } from "../../types";

const columns = [
  col("number", "Number", "text", 16),
  col("date", "Date", "date", 13),
  col("client", "Client", "text", 28),
  col("project", "Project", "text", 24),
  col("category", "Category", "text", 18),
  col("payment", "Payment method", "text", 16),
  col("reference", "Reference", "text", 22),
  col("amount", "Amount", "money", 16),
];

export function incomeFilter(f: Pick<ReportFilters, "q" | "from" | "to" | "project" | "category" | "paymentMethod">) {
  const filter: Record<string, unknown> = {};
  if (f.q) {
    const re = searchRegex(f.q);
    filter.$or = [{ client: re }, { number: re }, { reference: re }, { notes: re }];
  }
  if (f.category.length) filter.category = { $in: f.category };
  if (f.paymentMethod.length) filter.paymentMethod = { $in: f.paymentMethod };
  const project = projectMatch(f.project);
  if (project) filter.project = project;
  const range = rangeOf(f);
  if (range) filter.date = range;
  return filter;
}

export async function buildIncomeReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const docs = await Income.find(incomeFilter(f) as never)
    .sort({ date: 1, _id: 1 })
    .populate("project", "name")
    .lean();
  const rows: ReportRow[] = docs.map((i) => ({
    number: i.number,
    date: day(i.date),
    client: i.client,
    project: (i.project as unknown as { name: string } | null)?.name ?? "",
    category: labelOf(INCOME_CATEGORIES, (i.category ?? "other") as IncomeCategory),
    payment: labelOf(PAYMENT_METHODS, i.paymentMethod as PaymentMethod),
    reference: i.reference ?? "",
    amount: i.amount,
  }));
  const totals = sumTotals(columns, rows);
  const clients = new Set(docs.map((d) => d.client)).size;
  return {
    type: "income",
    title: "Income report",
    subtitle: await describeFilters(f, { categories: "income", vendor: false }),
    columns,
    rows,
    totals,
    summary: [
      { label: "Receipts", value: rows.length, type: "number" },
      { label: "Total income", value: Number(totals.amount ?? 0), type: "money" },
      { label: "Clients", value: clients, type: "number" },
      { label: "Average receipt", value: rows.length ? Number(totals.amount ?? 0) / rows.length : 0, type: "money" },
    ],
  };
}
