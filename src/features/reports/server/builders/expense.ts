import { salaryScope } from "@/server/auth/session";
import "server-only";

import { connectDB } from "@/server/db";
import { Expense } from "@/server/models";
import { expenseFilter } from "@/features/finance/expenses/queries";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PROJECT_STAGES, labelOf, type ExpenseCategory, type PaymentMethod, type ProjectStage } from "@/lib/constants";
import { round2 } from "@/lib/format";
import { col, day, describeFilters, sumTotals } from "../common";
import type { ReportData, ReportFilters, ReportRow } from "../../types";

export const EXPENSE_COLUMNS = [
  col("number", "Number", "text", 16),
  col("date", "Date", "date", 13),
  col("vendor", "Vendor", "text", 26),
  col("project", "Project", "text", 22),
  col("stage", "Stage", "text", 13),
  col("category", "Category", "text", 16),
  col("payment", "Payment", "text", 14),
  col("taxable", "Taxable", "money", 14),
  col("cgst", "CGST", "money", 12),
  col("sgst", "SGST", "money", 12),
  col("igst", "IGST", "money", 12),
  col("cess", "CESS", "money", 10),
  col("total", "Total", "money", 15),
  col("gstin", "GSTIN", "text", 18),
  col("invoice", "Invoice no", "text", 16),
];

type PopulatedProject = { name: string } | null;

/** Every expense in range, with its GST split. Filters match the Expenses page, so an export equals the list. */
export async function buildExpenseReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const scope = await salaryScope();
  const filterBase = expenseFilter({
    q: f.q,
    from: f.from,
    to: f.to,
    filters: {
      ...(f.project.length ? { project: f.project } : {}),
      ...(f.vendor.length ? { vendor: f.vendor } : {}),
      ...(f.category.length ? { category: f.category } : {}),
      ...(f.stage.length ? { stage: f.stage } : {}),
      ...(f.paymentMethod.length ? { paymentMethod: f.paymentMethod } : {}),
      ...(f.source.length ? { source: f.source } : {}),
    },
  });
  // Members never receive individual salary rows.
  const filter = (Object.keys(scope).length ? { $and: [filterBase, scope] } : filterBase) as typeof filterBase;
  const docs = await Expense.find(filter).sort({ date: 1, _id: 1 }).populate("project", "name").lean();

  const rows: ReportRow[] = docs.map((e) => {
    const g = e.gst;
    return {
      number: e.number,
      date: day(e.date),
      vendor: e.vendor,
      project: (e.project as unknown as PopulatedProject)?.name ?? "Overhead",
      stage: e.stage ? labelOf(PROJECT_STAGES, e.stage as ProjectStage) : "",
      category: labelOf(EXPENSE_CATEGORIES, e.category as ExpenseCategory),
      payment: labelOf(PAYMENT_METHODS, e.paymentMethod as PaymentMethod),
      taxable: g ? (g.taxableAmount ?? 0) : null,
      cgst: g ? (g.cgst ?? 0) : null,
      sgst: g ? (g.sgst ?? 0) : null,
      igst: g ? (g.igst ?? 0) : null,
      cess: g ? (g.cess ?? 0) : null,
      total: e.amount,
      gstin: g?.gstin ?? "",
      invoice: g?.invoiceNumber ?? "",
    };
  });
  const columns = EXPENSE_COLUMNS;
  const totals = sumTotals(columns, rows);
  const tax = round2(["cgst", "sgst", "igst", "cess"].reduce((s, k) => s + Number(totals[k] ?? 0), 0));

  return {
    type: "expense",
    title: "Expense report",
    subtitle: await describeFilters(f, { categories: "expense" }),
    columns,
    rows,
    totals,
    summary: [
      { label: "Expenses", value: rows.length, type: "number" },
      { label: "Total spend", value: Number(totals.total ?? 0), type: "money" },
      { label: "Taxable value", value: Number(totals.taxable ?? 0), type: "money" },
      { label: "GST paid", value: tax, type: "money" },
    ],
  };
}

