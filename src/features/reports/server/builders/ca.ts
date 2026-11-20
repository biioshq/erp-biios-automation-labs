import "server-only";

import { salaryScope } from "@/server/auth/session";
import { connectDB } from "@/server/db";
import { Expense, InventoryMovement } from "@/server/models";
import { expenseFilter } from "@/features/finance/expenses/queries";
import { round2 } from "@/lib/format";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { filtersForReport } from "../../schemas";
import { col, coversWholeMonths, describeFilters, rangeOf, sumTotals } from "../common";
import { buildExpenseReport } from "./expense";
import { buildGstReport } from "./gst";
import { buildIncomeReport } from "./income";
import type { ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

/** One pack for the chartered accountant: summary, registers and vendor totals. */
export async function buildCaReport(filters: ReportFilters): Promise<ReportData> {
  await connectDB();
  // Every table below uses this one filter set, so the summary, registers and vendor totals agree.
  const f = filtersForReport("ca", filters);
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
  const member = Object.keys(scope).length > 0;
  // Vendor totals are what was paid to each supplier: assignment expenses only move stock already
  // bought (and paid) to a project, so they are left out and the stock purchases themselves added below
  // from their movements. Purchase expenses repeat those movements, so they are left out here too.
  // Members never receive individual salary rows.
  const expenseF = { $and: [expenseFBase, { source: { $nin: ["inventory_assignment", "inventory_purchase"] } }, scope] };
  // The same rows as the expense register (buildExpenseReport), for the reconciliation lines.
  const registerF = { $and: [expenseFBase, scope, COMPANY_EXPENSES] };
  // Same rule as the GST register: purchases have no project, and count as "inventory" spend.
  const includePurchases = f.project.length === 0 && (f.category.length === 0 || f.category.includes("inventory"));
  // Stock with no cost (opening stock entered at ₹0) paid no vendor, so it stays out of the vendor totals.
  const purchaseQuery: Record<string, unknown> = { type: "purchase", $or: [{ "invoice.total": { $gt: 0 } }, { totalCost: { $gt: 0 } }] };
  const range = rangeOf(f);
  if (range) purchaseQuery.date = range;
  if (f.vendor.length) purchaseQuery.vendor = { $in: f.vendor };
  // A member's pack is a company P&L, so it carries salaries as one company-wide line. With a project or
  // vendor filter, or over part of a month, that line could be one person's pay, so then salaries are left out.
  const salariesInScope = f.category.length === 0 || f.category.includes("salaries");
  const salaryLine = member && salariesInScope && !f.project.length && !f.vendor.length && coversWholeMonths(f);
  const salariesHidden = member && salariesInScope && !salaryLine;
  type VendorGroup = { _id: string | null; gstin: string | null; count: number; taxable: number; tax: number; total: number };
  // Income has its own category list, so the expense category filter does not apply to it.
  const incomeFilters = { ...f, category: [], vendor: [] };
  const [expense, income, gst, vendors, purchases, salaries, assigned, purchaseExpenses] = await Promise.all([
    buildExpenseReport(f),
    buildIncomeReport(incomeFilters),
    buildGstReport(f),
    Expense.aggregate<VendorGroup>([
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
    ]),
    includePurchases
      ? InventoryMovement.aggregate<VendorGroup>([
          { $match: purchaseQuery },
          {
            $group: {
              _id: "$vendor",
              gstin: { $max: "$invoice.gstin" },
              count: { $sum: 1 },
              taxable: { $sum: { $ifNull: ["$invoice.taxableAmount", 0] } },
              tax: {
                $sum: { $add: [{ $ifNull: ["$invoice.cgst", 0] }, { $ifNull: ["$invoice.sgst", 0] }, { $ifNull: ["$invoice.igst", 0] }, { $ifNull: ["$invoice.cess", 0] }] },
              },
              // The invoice total when one was recorded, otherwise the cost of the stock.
              total: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$invoice.total", 0] }, 0] }, "$invoice.total", { $ifNull: ["$totalCost", 0] }] } },
            },
          },
        ])
      : Promise.resolve([] as VendorGroup[]),
    salaryLine
      ? Expense.aggregate<{ total: number }>([
          { $match: { $and: [expenseFBase, { category: "salaries" }] } as never },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
      : Promise.resolve([] as { total: number }[]),
    // Stock used on projects: in the expense register at cost, but left out of the vendor totals.
    Expense.aggregate<{ total: number }>([
      { $match: { $and: [registerF, { source: "inventory_assignment" }] } as never },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    // Stock purchases booked as expenses: in the register, and in the vendor totals through their movements.
    Expense.aggregate<{ total: number }>([
      { $match: { $and: [registerF, { source: "inventory_purchase" }] } as never },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const incomeTotal = Number(income.totals?.amount ?? 0);
  // For members the register has no salary rows; the company salary total is added back as its own line.
  const registerTotal = Number(expense.totals?.total ?? 0);
  const salaryTotal = round2(salaries[0]?.total ?? 0);
  const expenseTotal = round2(registerTotal + salaryTotal);
  const itc = (k: string) => Number(gst.totals?.[k] ?? 0);
  const itcTotal = round2(itc("cgst") + itc("sgst") + itc("igst") + itc("cess"));
  // Income has no vendor or expense category: with those filters it stays whole, so "profit" would mix bases.
  const incomeUnfiltered = f.vendor.length > 0 || f.category.length > 0;
  const profitLabel = incomeUnfiltered ? "Income less these expenses" : salariesHidden ? "Profit (salaries excluded)" : "Profit";

  // Expenses and stock purchases from the same supplier make one row.
  const byVendor = new Map<string, VendorGroup>();
  for (const v of [...vendors, ...purchases]) {
    const key = v._id || "No vendor recorded";
    const cur = byVendor.get(key);
    if (!cur) byVendor.set(key, { ...v, _id: key });
    else {
      cur.gstin = cur.gstin || v.gstin;
      cur.count += v.count;
      cur.taxable += v.taxable;
      cur.tax += v.tax;
      cur.total += v.total;
    }
  }
  const vendorRows: ReportRow[] = [...byVendor.values()].sort((a, b) => b.total - a.total).map((v) => ({
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

  const assignedTotal = round2(assigned[0]?.total ?? 0);
  const purchaseExpenseTotal = round2(purchaseExpenses[0]?.total ?? 0);
  const purchaseTotal = round2(purchases.reduce((s, p) => s + p.total, 0));
  const vendorTotal = Number(vendorSection.totals?.total ?? 0);
  const summaryRows: ReportRow[] = [
    { line: "Income received", amount: incomeTotal },
    ...(salaryLine
      ? [
          { line: "Expenses other than salaries", amount: registerTotal },
          { line: "Salaries & wages (company total)", amount: salaryTotal },
          { line: "Expenses", amount: expenseTotal, _kind: "subtotal" as const },
        ]
      : [{ line: salariesHidden ? "Expenses (salaries excluded)" : "Expenses", amount: expenseTotal }]),
    { line: profitLabel, amount: round2(incomeTotal - expenseTotal), _kind: "subtotal" },
    { line: "GST input credit: CGST", amount: itc("cgst") },
    { line: "GST input credit: SGST", amount: itc("sgst") },
    { line: "GST input credit: IGST", amount: itc("igst") },
    { line: "GST input credit: CESS", amount: itc("cess") },
    { line: "GST input credit: total", amount: itcTotal, _kind: "subtotal" },
    // "Expenses" counts older stock when it is used on a project (at cost) and newer stock when it is
    // bought, while the vendor table counts all stock when it is bought (at invoice value, from the
    // purchase movements), so the two differ by this much.
    { line: "Reconciliation to vendor-wise totals", amount: null, _kind: "subtotal" },
    { line: salaryLine ? "Expense register (other than salaries)" : "Expense register", amount: registerTotal },
    { line: "Less: stock used on projects", amount: assignedTotal ? -assignedTotal : 0 },
    // Only once purchases are booked as expenses, so older periods keep the lines they had.
    ...(purchaseExpenseTotal ? [{ line: "Less: stock purchases booked as expenses", amount: -purchaseExpenseTotal }] : []),
    { line: "Add: stock purchases at invoice value", amount: purchaseTotal },
    { line: "Vendor-wise total", amount: vendorTotal, _kind: "subtotal" },
  ];
  const summarySection: ReportSection = {
    title: "Summary",
    columns: [col("line", "Item", "text", 36), col("amount", "Amount", "money", 20)],
    rows: summaryRows,
    totals: null,
  };

  const expenseSection: ReportSection = { title: "Expense register", columns: expense.columns, rows: expense.rows, totals: expense.totals };
  const incomeSection: ReportSection = { title: "Income register", columns: income.columns, rows: income.rows, totals: income.totals };
  const gstSection: ReportSection = { title: "GST register", columns: gst.columns, rows: gst.rows, totals: gst.totals };

  return {
    type: "ca",
    // The primary table (used for CSV) is the expense register with its GST columns.
    ...expenseSection,
    title: "CA report",
    subtitle: [
      await describeFilters(f, { categories: "expense" }),
      salaryLine ? "Salaries appear as one company total, not as rows" : salariesHidden ? "Salaries are hidden for your role" : "",
      incomeUnfiltered ? "Income is all income for the period: it has no vendor or expense category to filter by" : "",
      assignedTotal || purchaseTotal ? "Vendor totals count stock when it is bought, at invoice value, not when it is used on a project" : "",
    ]
      .filter(Boolean)
      .join(" · "),
    summary: [
      { label: "Income", value: incomeTotal, type: "money" },
      { label: salariesHidden ? "Expenses (salaries excluded)" : "Expenses", value: expenseTotal, type: "money" },
      { label: profitLabel, value: round2(incomeTotal - expenseTotal), type: "money" },
      { label: "GST input credit", value: itcTotal, type: "money" },
    ],
    sections: [summarySection, expenseSection, incomeSection, gstSection, vendorSection],
    csvPrimaryOnly: true,
    hideSummaryBlock: true,
  };
}
