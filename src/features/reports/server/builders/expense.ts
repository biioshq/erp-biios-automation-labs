import { salaryScope } from "@/server/auth/session";
import "server-only";

import { connectDB } from "@/server/db";
import { Expense } from "@/server/models";
import { expenseListFilter, paymentSummaryOf } from "@/features/finance/expenses/queries";
import {
  DEPARTMENTS,
  EXPENSE_NATURES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PROJECT_STAGES,
  labelOf,
  type Department,
  type PaymentMethod,
  type ProjectStage,
} from "@/lib/constants";
import { getExpenseCategories } from "@/server/expense-categories";
import { categoryNature, expenseCategoryLabel } from "@/lib/expense-categories";
import { expenseNature } from "@/lib/expense-nature";
import { round2 } from "@/lib/format";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
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

/**
 * Columns added after the GST register columns, so files built before them keep every column in
 * place. The CA pack's expense register keeps EXPENSE_COLUMNS only.
 */
export const EXPENSE_STATUS_COLUMNS = [
  col("paymentStatus", "Payment status today", "text", 16),
  col("outstanding", "Outstanding today", "money", 15),
  col("nature", "Direct / indirect", "text", 12),
  col("department", "Department", "text", 16),
];

type PopulatedProject = { name: string } | null;

/**
 * Every expense in range, with its GST split. Filters match the Expenses page, so an export matches
 * the list and its totals. One difference: in a company view (no filter to named projects) the list
 * also shows stock used on projects that was counted at purchase, outside its totals; the export
 * leaves those rows out, so its rows add up to the same total.
 */
export async function buildExpenseReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const scope = await salaryScope();
  // One "today" for the status filter and the status column, so a row filtered as overdue shows overdue.
  const now = new Date();
  // expenseListFilter applies the admins' direct / indirect category settings, as the Expenses list does.
  const filterBase = await expenseListFilter(
    {
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
        ...(f.status?.length ? { status: f.status } : {}),
        ...(f.nature?.length ? { nature: f.nature } : {}),
        ...(f.department?.length ? { department: f.department } : {}),
        ...(f.bank?.length ? { bank: f.bank } : {}),
      },
    },
    now,
  );
  // Members never receive individual salary rows. Stock counted at purchase is always left out (as
  // in the Expenses list totals): its purchase is already a row. The project report shows it.
  const extra = [scope, COMPANY_EXPENSES].filter((x) => Object.keys(x).length);
  const filter = (extra.length ? { $and: [filterBase, ...extra] } : filterBase) as typeof filterBase;
  // Say so when it changes the result, since the Finance report and CA pack do show members a company salary total.
  const salariesHidden = Object.keys(scope).length > 0 && (f.category.length === 0 || f.category.includes("salaries"));
  const [docs, categories] = await Promise.all([Expense.find(filter).sort({ date: 1, _id: 1 }).populate("project", "name").lean(), getExpenseCategories()]);
  const categoryLabel = (value: string | null | undefined) => expenseCategoryLabel(categories, value);

  const rows: ReportRow[] = docs.map((e) => {
    const g = e.gst;
    const payment = paymentSummaryOf(e, now);
    return {
      number: e.number,
      date: day(e.date),
      vendor: e.vendor,
      project: (e.project as unknown as PopulatedProject)?.name ?? "Overhead",
      stage: e.stage ? labelOf(PROJECT_STAGES, e.stage as ProjectStage) : "",
      category: categoryLabel(e.category),
      payment: labelOf(PAYMENT_METHODS, e.paymentMethod as PaymentMethod),
      taxable: g ? (g.taxableAmount ?? 0) : null,
      cgst: g ? (g.cgst ?? 0) : null,
      sgst: g ? (g.sgst ?? 0) : null,
      igst: g ? (g.igst ?? 0) : null,
      cess: g ? (g.cess ?? 0) : null,
      total: e.amount,
      gstin: g?.gstin ?? "",
      invoice: g?.invoiceNumber ?? "",
      // Stock assignments move no money of their own: paid when the stock was bought.
      paymentStatus: payment.status === "stock" ? "From stock" : labelOf(PAYMENT_STATUSES, payment.status),
      outstanding: payment.status === "stock" ? 0 : payment.outstanding,
      nature: labelOf(EXPENSE_NATURES, expenseNature({ category: e.category, project: e.project }, categoryNature(categories, e.category))),
      department: e.department ? labelOf(DEPARTMENTS, e.department as Department) : "",
    };
  });
  const columns = [...EXPENSE_COLUMNS, ...EXPENSE_STATUS_COLUMNS];
  const totals = sumTotals(columns, rows);
  const tax = round2(["cgst", "sgst", "igst", "cess"].reduce((s, k) => s + Number(totals[k] ?? 0), 0));

  return {
    type: "expense",
    title: "Expense report",
    subtitle: [await describeFilters(f, { categories: "expense", passthrough: ["stage", "paymentMethod", "source", "status", "nature", "department"] }), salariesHidden ? "Salaries are hidden for your role" : ""].filter(Boolean).join(" · "),
    columns,
    rows,
    totals,
    summary: [
      { label: "Expenses", value: rows.length, type: "number" },
      { label: salariesHidden ? "Total spend (salaries excluded)" : "Total spend", value: Number(totals.total ?? 0), type: "money" },
      { label: "Taxable value", value: Number(totals.taxable ?? 0), type: "money" },
      { label: "GST paid", value: tax, type: "money" },
    ],
  };
}

