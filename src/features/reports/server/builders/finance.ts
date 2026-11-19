import "server-only";

import { connectDB } from "@/server/db";
import { salaryScope } from "@/server/auth/session";
import { Expense, Income } from "@/server/models";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, labelOf } from "@/lib/constants";
import { round2 } from "@/lib/format";
import { col, coversWholeMonths, describeFilters, projectMatch, rangeOf } from "../common";
import type { ReportData, ReportFilters, ReportRow, ReportSection } from "../../types";

type Group = { _id: string; total: number; count: number };

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
};

/** P&L for the period: income and expenses by category, the result, and a month-by-month table. */
export async function buildFinanceReport(f: ReportFilters): Promise<ReportData> {
  await connectDB();
  const match: Record<string, unknown> = {};
  const range = rangeOf(f);
  if (range) match.date = range;
  const project = projectMatch(f.project);
  if (project) match.project = project;
  // Company-wide salary totals are fine for members (as on the dashboard), but per project or over part
  // of a month they could single out one person's pay, so then a member's report leaves salaries out.
  const scope = await salaryScope();
  const member = Object.keys(scope).length > 0;
  const partMonth = !coversWholeMonths(f);
  const hideSalaries = member && (Boolean(project) || partMonth);
  const expenseMatch = hideSalaries ? { ...match, ...scope } : match;

  const byCategory = (m: Record<string, unknown>) => [{ $match: m }, { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } }];
  const byMonth = (m: Record<string, unknown>) => [
    { $match: m },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "Asia/Kolkata" } },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ];
  const [incCat, expCat, incMonth, expMonth] = await Promise.all([
    Income.aggregate<Group>(byCategory(match)),
    Expense.aggregate<Group>(byCategory(expenseMatch)),
    Income.aggregate<Group>(byMonth(match)),
    Expense.aggregate<Group>(byMonth(expenseMatch)),
  ]);

  const income = round2(incCat.reduce((s, r) => s + r.total, 0));
  const expenses = round2(expCat.reduce((s, r) => s + r.total, 0));
  const profit = round2(income - expenses);
  const margin = income > 0 ? profit / income : 0;

  const categoryRows = (groups: Group[], dict: readonly { value: string; label: string }[], total: number): ReportRow[] =>
    [...groups]
      .sort((a, b) => b.total - a.total)
      .map((g) => ({
        category: labelOf(dict as never, (g._id ?? "other") as never),
        // A member sees the salary total but not how many payments make it up (that count, with a
        // total, can point at one person's pay).
        entries: member && g._id === "salaries" ? null : g.count,
        amount: round2(g.total),
        share: total > 0 ? g.total / total : 0,
      }));
  const categoryColumns = [col("category", "Category", "text", 28), col("entries", "Entries", "number", 10), col("amount", "Amount", "money", 18), col("share", "Share", "percent", 10)];
  const categorySection = (title: string, rows: ReportRow[], total: number): ReportSection => ({
    title,
    columns: categoryColumns,
    rows,
    totals: { category: "Total", entries: rows.reduce((s, r) => s + Number(r.entries ?? 0), 0), amount: total, share: rows.length ? 1 : 0 },
  });

  const monthKeys = [...new Set([...incMonth, ...expMonth].map((r) => r._id))].sort();
  const incBy = new Map(incMonth.map((r) => [r._id, r.total]));
  const expBy = new Map(expMonth.map((r) => [r._id, r.total]));
  const monthRows: ReportRow[] = monthKeys.map((k) => {
    const i = round2(incBy.get(k) ?? 0);
    const e = round2(expBy.get(k) ?? 0);
    return { month: monthLabel(k), income: i, expenses: e, profit: round2(i - e) };
  });
  const monthSection: ReportSection = {
    title: "Month by month",
    columns: [col("month", "Month", "text", 16), col("income", "Income", "money", 18), col("expenses", "Expenses", "money", 18), col("profit", "Profit", "money", 18)],
    rows: monthRows,
    totals: { month: "Total", income, expenses, profit },
  };

  const incRows = categoryRows(incCat, INCOME_CATEGORIES, income);
  const expRows = categoryRows(expCat, EXPENSE_CATEGORIES, expenses);
  const statement: ReportSection = {
    title: "Profit and loss",
    columns: [col("line", "Line", "text", 34), col("amount", "Amount", "money", 18)],
    rows: [
      { line: "Income", amount: null, _kind: "subtotal" },
      ...incRows.map((r) => ({ line: `  ${r.category}`, amount: r.amount })),
      { line: "Total income", amount: income, _kind: "subtotal" },
      { line: "Expenses", amount: null, _kind: "subtotal" },
      ...expRows.map((r) => ({ line: `  ${r.category}`, amount: r.amount })),
      { line: "Total expenses", amount: expenses, _kind: "subtotal" },
    ],
    totals: { line: "Net profit", amount: profit },
  };

  const sections = [
    statement,
    categorySection("Income by category", incRows, income),
    categorySection("Expenses by category", expRows, expenses),
    monthSection,
  ];
  return {
    type: "finance",
    subtitle: [await describeFilters(f, { vendor: false }), hideSalaries ? (project ? "Salaries are hidden for your role" : "Salaries are hidden for your role: they are shown for whole months only") : ""].filter(Boolean).join(" · "),
    summary: [
      { label: "Income", value: income, type: "money" },
      { label: "Expenses", value: expenses, type: "money" },
      { label: "Profit", value: profit, type: "money" },
      { label: "Profit margin", value: margin, type: "percent" },
    ],
    ...statement,
    title: "Finance report",
    sections,
  };
}
