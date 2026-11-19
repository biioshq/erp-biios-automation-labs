import { salaryScope } from "@/server/auth/session";
import "server-only";

import { connectDB } from "@/server/db";
import { Expense } from "@/server/models";
import { expenseFilter } from "@/features/finance/expenses/queries";
import { round2 } from "@/lib/format";
import { col, describeFilters, sumTotals } from "../common";
import { buildExpenseReport } from "./expense";
import { buildGstReport } from "./gst";
import { buildIncomeReport } from "./income";
import type { ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/** One pack for the chartered accountant: summary, registers and vendor totals. */
export async function buildCaReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const scope = await salaryScope();
  const expenseFBase = expenseFilter({
    q: "",
    from: f.from,
    to: f.to,
    filters: {
      ...(f.project.length ? { project: f.project } : {}),
      ...(f.vendor.length ? { vendor: f.vendor } : {}),
      ...(f.category.length ? { category: f.category } : {}),
    },
  });
  // Members never receive individual salary rows.
  const expenseF = (Object.keys(scope).length ? { $and: [expenseFBase, scope] } : expenseFBase) as typeof expenseFBase;
  // Income has its own category list, so the expense category filter does not apply to it.
  const incomeFilters = { ...f, category: [], vendor: [] };
  const [expense, income, gst, vendors] = await Promise.all([
    buildExpenseReport(f),
    buildIncomeReport(incomeFilters),
    buildGstReport(f),
    Expense.aggregate<{ _id: string; gstin: string | null; count: number; taxable: number; tax: number; total: number }>([
      { $match: expenseF as never },
      {
        $group: {
          _id: "$vendor",
          gstin: { $max: "$gst.gstin" },
          count: { $sum: 1 },
          taxable: { $sum: { $ifNull: ["$gst.taxableAmount", 0] } },
          tax: { $sum: { $add: [{ $ifNull: ["$gst.cgst", 0] }, { $ifNull: ["$gst.sgst", 0] }, { $ifNull: ["$gst.igst", 0] }, { $ifNull: ["$gst.cess", 0] }] } },
          total: { $sum: "$amount" },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const incomeTotal = Number(income.totals?.amount ?? 0);
  const expenseTotal = Number(expense.totals?.total ?? 0);
  const itc = (k: string) => Number(gst.totals?.[k] ?? 0);
  const itcTotal = round2(itc("cgst") + itc("sgst") + itc("igst") + itc("cess"));

  const summaryRows: ReportRow[] = [
    { line: "Income received", amount: incomeTotal },
    { line: "Expenses paid", amount: expenseTotal },
    { line: "Profit", amount: round2(incomeTotal - expenseTotal), _kind: "subtotal" },
    { line: "GST input credit: CGST", amount: itc("cgst") },
    { line: "GST input credit: SGST", amount: itc("sgst") },
    { line: "GST input credit: IGST", amount: itc("igst") },
    { line: "GST input credit: CESS", amount: itc("cess") },
    { line: "GST input credit: total", amount: itcTotal, _kind: "subtotal" },
  ];
  const summarySection: ReportSection = {
    title: "Summary",
    columns: [col("line", "Item", "text", 36), col("amount", "Amount", "money", 20)],
    rows: summaryRows,
    totals: null,
  };

  const vendorRows: ReportRow[] = vendors.map((v) => ({
    vendor: v._id,
    gstin: v.gstin ?? "",
    entries: v.count,
    taxable: round2(v.taxable),
    tax: round2(v.tax),
    total: round2(v.total),
  }));
  const vendorColumns = [
    col("vendor", "Vendor", "text", 30),
    col("gstin", "GSTIN", "text", 20),
    col("entries", "Entries", "number", 10),
    col("taxable", "Taxable", "money", 16),
    col("tax", "GST", "money", 14),
    col("total", "Total paid", "money", 17),
  ];
  const vendorSection: ReportSection = {
    title: "Vendor-wise totals",
    columns: vendorColumns,
    rows: vendorRows,
    totals: sumTotals(vendorColumns, vendorRows, "Total", ["money", "number"]),
  };

  const expenseSection: ReportSection = { title: "Expense register", columns: expense.columns, rows: expense.rows, totals: expense.totals };
  const incomeSection: ReportSection = { title: "Income register", columns: income.columns, rows: income.rows, totals: income.totals };
  const gstSection: ReportSection = { title: "GST register", columns: gst.columns, rows: gst.rows, totals: gst.totals };

  return {
    type: "ca",
    // The primary table (used for CSV) is the expense register with its GST columns.
    ...expenseSection,
    title: "CA report",
    subtitle: await describeFilters(f, { categories: "expense" }),
    summary: [
      { label: "Income", value: incomeTotal, type: "money" },
      { label: "Expenses", value: expenseTotal, type: "money" },
      { label: "Profit", value: round2(incomeTotal - expenseTotal), type: "money" },
      { label: "GST input credit", value: itcTotal, type: "money" },
    ],
    sections: [summarySection, expenseSection, incomeSection, gstSection, vendorSection],
    csvPrimaryOnly: true,
    hideSummaryBlock: true,
  };
}
