import { canSeeSalaries, salaryScope } from "@/server/auth/session";
import "server-only";

import type { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Income, Project, RecurringExpense } from "@/server/models";
import { iso } from "@/server/serialize";
import {
  COMPANY_EXPENSES,
  budgetUsage,
  financeTotals,
  inventorySnapshot,
  monthlyExpensesByCategory,
  monthlyIncomeExpense,
} from "@/server/services/metrics";
import { INCOME_CATEGORIES, labelOf, type IncomeCategory, type ProjectStatus } from "@/lib/constants";
import { getExpenseCategoryLabeler } from "@/server/expense-categories";
import { isBuiltInExpenseCategory } from "@/lib/expense-categories";
import { round2 } from "@/lib/format";
import { endOfDayIST, toDateInput } from "@/lib/dates";
import { monthlyEquivalent } from "@/lib/recurrence";
import type { RecurringFrequency } from "@/lib/constants";
import { OTHER_KEY, resolvePeriod, type DashboardPeriod } from "./periods";
import type { BudgetRow, CategoryStack, FinanceDashboardData, RecurringCommitments, Transaction } from "./types";

const TOP_CATEGORIES = 5;

/** Change relative to a previous value; null when there is nothing to compare with. */
function delta(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Colours for categories admins added, light and dark. None of them is one of the five chart colours
 * the built-ins take by rank, so a custom category keeps its own colour whatever the period.
 */
const CUSTOM_CATEGORY_COLORS = [
  { light: "#8a6d00", dark: "#d6b53a" },
  { light: "#3d8a2f", dark: "#7cc96b" },
  { light: "#1f7fa3", dark: "#5cc0e6" },
  { light: "#8f5a3c", dark: "#cf9877" },
  { light: "#b23a3a", dark: "#f07b7b" },
  { light: "#8e3f8f", dark: "#d38bd4" },
];

/** The same colour for a value every time; if another custom category in the chart has it already, the next free one. */
function customCategoryColor(value: string, taken: Set<number>) {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  let slot = hash % CUSTOM_CATEGORY_COLORS.length;
  for (let i = 0; i < CUSTOM_CATEGORY_COLORS.length && taken.has(slot); i++) slot = (slot + 1) % CUSTOM_CATEGORY_COLORS.length;
  taken.add(slot);
  return CUSTOM_CATEGORY_COLORS[slot];
}

/** Top categories by spend over the window, with the rest folded into "Other". */
function stackCategories(
  raw: { month: string; category: string; total: number }[],
  months: string[],
  categoryLabel: (value: string) => string,
): CategoryStack {
  const totals = new Map<string, number>();
  for (const r of raw) totals.set(r.category, (totals.get(r.category) ?? 0) + r.total);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  const top = ranked.slice(0, TOP_CATEGORIES);
  const hasOther = ranked.length > TOP_CATEGORIES;
  const taken = new Set<number>();
  const series: CategoryStack["series"] = [
    ...top.map((key) => ({ key, label: categoryLabel(key), ...(isBuiltInExpenseCategory(key) ? {} : { color: customCategoryColor(key, taken) }) })),
    ...(hasOther ? [{ key: OTHER_KEY, label: "Other" }] : []),
  ];
  const rows = months.map((month) => {
    const row: { month: string } & Record<string, number | string> = { month };
    for (const s of series) row[s.key] = 0;
    for (const r of raw.filter((x) => x.month === month)) {
      const key = top.includes(r.category) ? r.category : OTHER_KEY;
      row[key] = round2(Number(row[key]) + r.total);
    }
    return row;
  });
  return { series, rows, total: round2([...totals.values()].reduce((a, b) => a + b, 0)) };
}

type PopulatedProject = { _id: Types.ObjectId; name: string; color?: string } | null;
const projectOf = (value: unknown): Transaction["project"] => {
  const p = value as PopulatedProject;
  return p?._id ? { id: String(p._id), name: p.name, color: p.color ?? "#4a82cc" } : null;
};

async function recentTransactions(limit = 10): Promise<Transaction[]> {
  const [expenses, income, expenseLabel] = await Promise.all([
    // Company money only: stock used on a project that was expensed when bought is shown with its purchase.
    Expense.find({ ...(await salaryScope()), ...COMPANY_EXPENSES }, { number: 1, vendor: 1, amount: 1, date: 1, category: 1, project: 1 })
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .populate("project", "name color")
      .lean(),
    Income.find({}, { number: 1, client: 1, amount: 1, date: 1, category: 1, project: 1 })
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .populate("project", "name color")
      .lean(),
    getExpenseCategoryLabeler(),
  ]);
  const merged: (Transaction & { sortKey: number })[] = [
    ...expenses.map((e) => ({
      id: String(e._id),
      direction: "expense" as const,
      number: e.number,
      party: e.vendor,
      amount: e.amount,
      date: iso(e.date)!,
      category: e.category,
      categoryLabel: expenseLabel(e.category),
      project: projectOf(e.project),
      href: `/finance/expenses?view=${e._id}`,
      sortKey: new Date(e.date).getTime(),
    })),
    ...income.map((i) => ({
      id: String(i._id),
      direction: "income" as const,
      number: i.number,
      party: i.client,
      amount: i.amount,
      date: iso(i.date)!,
      category: i.category ?? "",
      categoryLabel: labelOf(INCOME_CATEGORIES, (i.category ?? "") as IncomeCategory),
      project: projectOf(i.project),
      href: `/finance/income?view=${i._id}`,
      sortKey: new Date(i.date).getTime(),
    })),
  ];
  return merged
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, limit)
    .map((t) => ({ id: t.id, direction: t.direction, number: t.number, party: t.party, amount: t.amount, date: t.date, category: t.category, categoryLabel: t.categoryLabel, project: t.project, href: t.href }));
}

const UPCOMING_COUNT = 3;

/** What the active recurring schedules commit the company to each month, and what is due next. */
async function recurringCommitments(): Promise<RecurringCommitments> {
  const [docs, seesSalaries] = await Promise.all([
    RecurringExpense.find(
      { status: "active" },
      { name: 1, amount: 1, frequency: 1, category: 1, nextRunDate: 1, endDate: 1 },
    )
      .sort({ nextRunDate: 1 })
      .lean(),
    canSeeSalaries(),
  ]);
  // The totals are company-wide and include salaries for everyone, like the
  // expense totals on the same page. Only the named schedules in the "next
  // due" list would show one person's pay, so members do not get salary rows there.
  let perMonth = 0;
  let salariesPerMonth = 0;
  for (const d of docs) {
    const monthly = monthlyEquivalent(d.amount, d.frequency as RecurringFrequency);
    perMonth += monthly;
    if (d.category === "salaries") salariesPerMonth += monthly;
  }
  return {
    perMonth: round2(perMonth),
    salariesPerMonth: round2(salariesPerMonth),
    activeCount: docs.length,
    upcoming: docs
      .filter((d) => seesSalaries || d.category !== "salaries")
      .filter((d) => !d.endDate || d.nextRunDate.getTime() <= d.endDate.getTime())
      .slice(0, UPCOMING_COUNT)
      .map((d) => ({ id: String(d._id), name: d.name, date: iso(d.nextRunDate)!, amount: d.amount })),
  };
}

export async function getFinanceDashboard(period: DashboardPeriod): Promise<FinanceDashboardData> {
  await connectDB();
  const now = new Date();
  const range = resolvePeriod(period, now);
  // The "Monthly spending" tile compares this month with the same days of last month.
  const month = resolvePeriod("month", now);
  // The previous side of every delta stops at today's date, so the current side
  // must too: entries dated later this period (a rent bill for the 30th) would
  // otherwise count on one side only and overstate the change. The headline
  // figures still cover the whole period.
  const today = endOfDayIST(now);
  const toToday = (to: Date) => new Date(Math.min(to.getTime(), today.getTime()));

  const [totals, current, previous, thisMonth, thisMonthToDate, lastMonth, inventory, statusCounts, monthly, categoryRows, budgetRows, transactions, recurring, expenseLabel] =
    await Promise.all([
      financeTotals({ from: range.from, to: range.to }),
      range.previous && range.to ? financeTotals({ from: range.from, to: toToday(range.to) }) : Promise.resolve(null),
      range.previous ? financeTotals({ from: range.previous.from, to: range.previous.to }) : Promise.resolve(null),
      financeTotals({ from: month.from, to: month.to }),
      financeTotals({ from: month.from, to: toToday(month.to!) }),
      financeTotals({ from: month.previous!.from, to: month.previous!.to }),
      inventorySnapshot(),
      Project.aggregate<{ _id: ProjectStatus; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      monthlyIncomeExpense(12),
      monthlyExpensesByCategory(6),
      budgetUsage({ status: ["active", "planning", "on_hold"] }),
      recentTransactions(10),
      recurringCommitments(),
      getExpenseCategoryLabeler(),
    ]);

  const projectCount = (status: ProjectStatus) => statusCounts.find((s) => s._id === status)?.n ?? 0;
  const months = monthly.slice(-6).map((m) => m.month);

  const budgets: BudgetRow[] = budgetRows
    .filter((b) => b.budget > 0 || b.spent > 0)
    .map((b) => ({ ...b, status: b.status as ProjectStatus }))
    .sort((a, b) => b.usage - a.usage || b.budget - a.budget)
    .slice(0, 8);

  const projectsTotal = statusCounts.reduce((sum, s) => sum + s.n, 0);
  const everything = await Promise.all([Income.estimatedDocumentCount(), Expense.estimatedDocumentCount()]);

  return {
    period,
    periodLabel: range.label,
    periodPhrase: range.phrase,
    periodDates: range.from && range.to ? { from: toDateInput(range.from), to: toDateInput(range.to) } : null,
    previousPhrase: range.previous?.phrase ?? null,
    kpis: {
      income: totals.income,
      expenses: totals.expenses,
      profit: totals.profit,
      margin: totals.income > 0 ? totals.profit / totals.income : null,
      gstPaid: totals.gstPaid,
      incomeDelta: current && previous ? delta(current.income, previous.income) : null,
      expenseDelta: current && previous ? delta(current.expenses, previous.expenses) : null,
      profitDelta: current && previous ? delta(current.profit, previous.profit) : null,
      monthSpend: thisMonth.expenses,
      monthSpendDelta: delta(thisMonthToDate.expenses, lastMonth.expenses),
      inventoryValue: inventory.value,
      inventoryItems: inventory.items,
      activeProjects: projectCount("active"),
      planningProjects: projectCount("planning"),
      onHoldProjects: projectCount("on_hold"),
    },
    monthly,
    categories: stackCategories(categoryRows, months, expenseLabel),
    budgets,
    transactions,
    recurring,
    empty: everything[0] + everything[1] + projectsTotal === 0,
  };
}
