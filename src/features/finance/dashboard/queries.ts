import "server-only";

import type { Types } from "mongoose";
import { canSeeSalaries, salaryScope } from "@/server/auth/session";
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
import { addDays, endOfDayIST, financialYearIST, fromDateInput, monthKeyIST, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { ledgerAsOf } from "@/server/accounting/ledger";
import { cashFlow, positionSummary, profitAndLoss } from "@/server/accounting/statements";
import { liabilityRows, payablesSummary, receivablesSummary } from "@/server/finance/summaries";
import { listProjectFinances } from "@/features/finance/projects/queries";
import { monthlyEquivalent } from "@/lib/recurrence";
import type { RecurringFrequency } from "@/lib/constants";
import { OTHER_KEY, resolvePeriod, type DashboardPeriod, type PeriodSelection } from "./periods";
import type {
  BudgetRow,
  CategoryStack,
  DueItem,
  DuePayments,
  FinanceDashboardData,
  MonthlyAverage,
  MonthlyPoint,
  OpenItemsTotals,
  PositionFigures,
  ProjectSummaryRow,
  ProjectTotals,
  RecurringCommitments,
  Transaction,
  Trends,
  TrendPoint,
} from "./types";

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

/** Months from `a` to `b` (both IST month starts): 0 when the same month. */
function monthsBetween(a: Date, b: Date): number {
  const [ay, am] = monthKeyIST(a).split("-").map(Number);
  const [by, bm] = monthKeyIST(b).split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** Months averaged when the selected period has no whole month yet ("This month", or the first month of a quarter or year). */
const FALLBACK_MONTHS = 3;

/** The first month that starts on or after `d` (d's own month when d is the 1st). */
const monthOnOrAfter = (d: Date) => (toDateInput(d).endsWith("-01") ? startOfMonthIST(d) : startOfMonthIST(d, 1));
/** The month after d's month when d is its month's last day, else d's month: the end (exclusive) of the whole months up to d. */
const monthEndingBy = (d: Date) => (toDateInput(addDays(startOfDayIST(d), 1)).endsWith("-01") ? startOfMonthIST(d, 1) : startOfMonthIST(d));

/**
 * Average spend per month over whole calendar months, 1st to the last day:
 *
 *   monthly average = company expenses of those months ÷ number of months
 *
 * The months are the selected period's months that have ended (the current month is left out until
 * it ends, so a half month never pulls the average down). Months with no expenses count as ₹0.
 * Months before the first recorded expense are left out, so a young company is not averaged over
 * months before it started. When the period has no whole month yet, the three months before this
 * one are used. Null when no whole month of records exists.
 *
 * A custom range uses only the whole months inside it (a range from 15 Jan to 10 Apr averages
 * February and March); with none, the three months before the range ends.
 */
async function monthlyAverage(range: { from?: Date; to?: Date; custom: boolean }, now: Date): Promise<MonthlyAverage | null> {
  const first = await Expense.findOne(COMPANY_EXPENSES, { date: 1 }).sort({ date: 1 }).lean();
  if (!first) return null;
  const thisMonth = startOfMonthIST(now);
  const firstMonth = startOfMonthIST(first.date);
  const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
  const earlier = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
  // Months up to `end` (exclusive) count. Presets end with the current month; a custom range may end earlier.
  const end = range.custom && range.to ? earlier(thisMonth, monthEndingBy(range.to)) : thisMonth;
  let from = later(range.from ? monthOnOrAfter(range.from) : firstMonth, firstMonth);
  let fallback = false;
  if (monthsBetween(from, end) <= 0) {
    from = later(startOfMonthIST(end, -FALLBACK_MONTHS), firstMonth);
    fallback = true;
  }
  const months = monthsBetween(from, end);
  if (months <= 0) return null;
  const to = new Date(end.getTime() - 1);
  const totals = await financeTotals({ from, to });
  return {
    value: round2(totals.expenses / months),
    months,
    fromMonth: monthKeyIST(from),
    toMonth: monthKeyIST(to),
    fallback,
    ...(fallback && end.getTime() !== thisMonth.getTime() ? { beforeRangeEnd: true } : {}),
  };
}

/* Trends: months, financial quarters and financial years */

const TREND_QUARTERS = 8;
const TREND_YEARS = 5;

/** Months from the start of the financial year TREND_YEARS - 1 years ago up to this month. */
function trendMonths(now: Date): number {
  const fyStartYear = Number(toDateInput(financialYearIST(now).start).slice(0, 4));
  return monthsBetween(fromDateInput(`${fyStartYear - (TREND_YEARS - 1)}-04-01`), startOfMonthIST(now)) + 1;
}

/** "2026-11" → financial year start year and quarter (Q1 is April to June). */
function fiscalOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  const fy = m >= 4 ? y : y - 1;
  return { fy, quarter: Math.floor(((m - 4 + 12) % 12) / 3) + 1 };
}
const fyShort = (fy: number) => `${String(fy % 100).padStart(2, "0")}-${String((fy + 1) % 100).padStart(2, "0")}`;

function groupTrend(points: MonthlyPoint[], keyOf: (month: string) => { key: string; label: string }): TrendPoint[] {
  const out = new Map<string, TrendPoint>();
  for (const p of points) {
    const { key, label } = keyOf(p.month);
    const t = out.get(key) ?? { key, label, income: 0, expenses: 0, profit: 0 };
    t.income = round2(t.income + p.income);
    t.expenses = round2(t.expenses + p.expenses);
    t.profit = round2(t.income - t.expenses);
    out.set(key, t);
  }
  return [...out.values()];
}

/** Income and expenses (cash basis, as the cards) per month, financial quarter and financial year. */
function buildTrends(points: MonthlyPoint[]): Trends {
  return {
    month: points.slice(-12).map((p) => ({ key: p.month, label: p.month, income: p.income, expenses: p.expenses, profit: p.profit })),
    quarter: groupTrend(points, (m) => {
      const { fy, quarter } = fiscalOf(m);
      return { key: `${fy}-Q${quarter}`, label: `Q${quarter} ${fyShort(fy)}` };
    }).slice(-TREND_QUARTERS),
    year: groupTrend(points, (m) => {
      const { fy } = fiscalOf(m);
      return { key: String(fy), label: `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}` };
    }).slice(-TREND_YEARS),
  };
}

/* Admin figures from the accounting engine */

/**
 * Balance sheet totals as of the period's end (today at the latest), and cash in and out and the
 * P&L profit over the period. All three read the same computed ledger.
 */
async function positionFigures(range: { from?: Date; to?: Date }, now: Date): Promise<PositionFigures> {
  // One date object for all three calls, so they share one ledger build per request.
  const asOf = range.to ?? endOfDayIST(now);
  const ledger = await ledgerAsOf(asOf);
  // All time starts at the first record in the books.
  const from = range.from ?? startOfDayIST(ledger.postings[0]?.date ?? now);
  const [position, flow, pl] = await Promise.all([positionSummary(asOf), cashFlow(from, asOf), profitAndLoss(from, asOf)]);
  // Activity lines leave out transfers between own accounts; per-account inflows would count them twice.
  const lines = flow.activities.flatMap((a) => a.lines);
  const cashIn = round2(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0));
  const cashOut = round2(-lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0));
  return {
    asOf: position.asOf,
    asOfToday: position.asOf === toDateInput(now),
    totalAssets: position.totalAssets,
    totalLiabilities: position.totalLiabilities,
    equity: position.equity,
    cash: position.cash,
    difference: position.difference,
    cashIn,
    cashOut,
    plProfit: pl.profit,
    // The period's own days: the statements stop at today by themselves, and a range that starts
    // after today must not turn into a reversed from / to pair.
    statementQuery: new URLSearchParams({ from: toDateInput(from), to: toDateInput(asOf) }).toString(),
  };
}

/* Upcoming and overdue payments */

const DUE_WINDOW_DAYS = 30;
const DUE_LIST = 8;

type PayablesSummary = Awaited<ReturnType<typeof payablesSummary>>;
type ReceivablesSummary = Awaited<ReturnType<typeof receivablesSummary>>;

/** Overdue first (oldest first), then the soonest due. */
const byUrgency = (a: DueItem, b: DueItem) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date);
const totalOf = (items: DueItem[], overdue: boolean) => round2(items.filter((i) => i.overdue === overdue).reduce((s, i) => s + i.amount, 0));

/**
 * What the company has to pay (supplier bills, loans for people who see the company's financial
 * position, recurring schedules) and to receive (customer invoices) that is overdue or due in the
 * next 30 days. People without the salaries data permission do not get salary bills or salary
 * schedules in the lists, as elsewhere.
 */
async function duePayments(now: Date, seesPosition: boolean, payables: PayablesSummary, receivables: ReceivablesSummary): Promise<DuePayments> {
  const seesSalaries = await canSeeSalaries();
  const today = toDateInput(now);
  const soon = toDateInput(addDays(now, DUE_WINDOW_DAYS));
  const inWindow = (status: string, due: string | null) => status === "overdue" || Boolean(due && due >= today && due <= soon);

  const [loans, schedules] = await Promise.all([
    seesPosition ? liabilityRows(now) : Promise.resolve([]),
    RecurringExpense.find({ status: "active", nextRunDate: { $lte: endOfDayIST(addDays(now, DUE_WINDOW_DAYS)) } }, { name: 1, amount: 1, category: 1, nextRunDate: 1, endDate: 1, vendor: 1 })
      .sort({ nextRunDate: 1 })
      .lean(),
  ]);

  const pay: DueItem[] = [
    ...payables.rows
      .filter((r) => inWindow(r.status, r.dueDate) && (seesSalaries || r.category !== "salaries"))
      .map((r): DueItem => ({ id: r.id, kind: "bill", title: r.number, party: r.vendor, date: r.dueDate ?? r.date, amount: r.outstanding, overdue: r.status === "overdue", href: `/finance/expenses?view=${r.id}` })),
    ...loans
      .filter((l) => l.outstanding > 0 && inWindow(l.status, l.dueDate))
      // Loans open on the loans page; other obligations (TDS, salaries due) on their side's page.
      .map((l): DueItem => ({
        id: l.id,
        kind: l.kind === "loan" ? "loan" : "due",
        title: l.name,
        party: l.lender,
        date: l.dueDate!,
        amount: l.outstanding,
        overdue: l.status === "overdue",
        href: l.kind === "loan" ? `/finance/liabilities/loans?view=${l.id}` : `/finance/liabilities/${l.current ? "current" : "non-current"}?view=${l.id}`,
      })),
    // Schedules post their expense by themselves, so a run date in the past is not "overdue".
    ...schedules
      .filter((d) => (seesSalaries || d.category !== "salaries") && (!d.endDate || d.nextRunDate.getTime() <= d.endDate.getTime()))
      .map((d): DueItem => ({
        id: String(d._id),
        kind: "recurring",
        title: d.name,
        party: d.vendor,
        date: toDateInput(d.nextRunDate),
        amount: d.amount,
        overdue: false,
        href: `/finance/recurring?view=${d._id}`,
      })),
  ].sort(byUrgency);

  const receive = receivables.rows
    .filter((r) => inWindow(r.status, r.dueDate))
    .map((r): DueItem => ({ id: r.id, kind: "invoice", title: r.number, party: r.client, date: r.dueDate ?? r.date, amount: r.outstanding, overdue: r.status === "overdue", href: `/finance/invoices?view=${r.id}` }))
    .sort(byUrgency);

  return {
    pay: pay.slice(0, DUE_LIST),
    receive: receive.slice(0, DUE_LIST),
    payCount: pay.length,
    receiveCount: receive.length,
    payOverdue: totalOf(pay, true),
    payUpcoming: totalOf(pay, false),
    receiveOverdue: totalOf(receive, true),
    receiveUpcoming: totalOf(receive, false),
    salariesHidden: !seesSalaries,
  };
}

const openTotals = (s: PayablesSummary | ReceivablesSummary): OpenItemsTotals => ({
  total: s.total,
  count: s.count,
  overdue: s.overdue,
  overdueCount: s.overdueCount,
  dueSoon: s.dueSoon,
});

/* Projects */

const OPEN_STATUSES: ProjectStatus[] = ["planning", "active", "on_hold"];
const PROJECT_ROWS = 8;

/** Open projects' budget and lifetime spend, and the biggest of them by spend. */
async function projectOverview(): Promise<{ totals: ProjectTotals; rows: ProjectSummaryRow[] }> {
  const { rows } = await listProjectFinances(OPEN_STATUSES);
  const budget = round2(rows.reduce((s, r) => s + r.budget, 0));
  const spent = round2(rows.reduce((s, r) => s + r.finance.spent, 0));
  return {
    totals: { count: rows.length, budget, spent, utilisation: budget > 0 ? spent / budget : null },
    rows: [...rows]
      .sort((a, b) => b.finance.spent - a.finance.spent || b.finance.revenue.revenue - a.finance.revenue.revenue)
      .slice(0, PROJECT_ROWS)
      .map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        color: r.color,
        status: r.status,
        revenue: r.finance.revenue.revenue,
        received: r.finance.revenue.received,
        outstanding: r.finance.revenue.outstanding,
        spent: r.finance.spent,
        budget: r.budget,
        utilisation: r.outlook.utilisation,
        estimatedProfit: r.outlook.estimatedProfit,
      })),
  };
}

/**
 * Everything on the Finance dashboard for a period. Without the financial position data permission
 * the dashboard comes without the balance sheet, cash and loan figures (null `position`, no loans
 * in due payments): those queries do not run at all.
 */
export async function getFinanceDashboard(
  selection: PeriodSelection | DashboardPeriod,
  viewer: { financialPosition: boolean } = { financialPosition: false },
): Promise<FinanceDashboardData> {
  await connectDB();
  const { period, from: customFrom, to: customTo } = typeof selection === "string" ? { period: selection, from: undefined, to: undefined } : selection;
  const now = new Date();
  const range = resolvePeriod(period, now, { from: customFrom, to: customTo });
  const custom = range.period === "custom" && range.from && range.to ? { from: toDateInput(range.from), to: toDateInput(range.to) } : null;
  const month = resolvePeriod("month", now);
  // The previous side of every delta stops at today's date, so the current side
  // must too: entries dated later this period (a rent bill for the 30th) would
  // otherwise count on one side only and overstate the change. The headline
  // figures still cover the whole period.
  const today = endOfDayIST(now);
  const toToday = (to: Date) => new Date(Math.min(to.getTime(), today.getTime()));

  const [totals, current, previous, thisMonth, average, inventory, statusCounts, trendPoints, categoryRows, budgetRows, transactions, recurring, expenseLabel] =
    await Promise.all([
      financeTotals({ from: range.from, to: range.to }),
      range.previous && range.to ? financeTotals({ from: range.from, to: toToday(range.to) }) : Promise.resolve(null),
      range.previous ? financeTotals({ from: range.previous.from, to: range.previous.to }) : Promise.resolve(null),
      financeTotals({ from: month.from, to: toToday(month.to!) }),
      monthlyAverage({ from: range.from, to: range.to, custom: range.period === "custom" }, now),
      inventorySnapshot(),
      Project.aggregate<{ _id: ProjectStatus; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      monthlyIncomeExpense(trendMonths(now)),
      monthlyExpensesByCategory(6),
      budgetUsage({ status: OPEN_STATUSES }),
      recentTransactions(10),
      recurringCommitments(),
      getExpenseCategoryLabeler(),
    ]);
  const [payables, receivables, projects, position] = await Promise.all([
    payablesSummary(now),
    receivablesSummary(now),
    projectOverview(),
    viewer.financialPosition ? positionFigures(range, now) : Promise.resolve(null),
  ]);
  const due = await duePayments(now, viewer.financialPosition, payables, receivables);

  const monthly = trendPoints.slice(-12);
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
    period: range.period,
    custom,
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
      monthlyAverage: average,
      monthToDate: thisMonth.expenses,
      inventoryValue: inventory.value,
      inventoryItems: inventory.items,
      activeProjects: projectCount("active"),
      planningProjects: projectCount("planning"),
      onHoldProjects: projectCount("on_hold"),
    },
    monthly,
    trends: buildTrends(trendPoints),
    position,
    receivables: openTotals(receivables),
    payables: openTotals(payables),
    projectTotals: projects.totals,
    projectSummaries: projects.rows,
    due,
    categories: stackCategories(categoryRows, months, expenseLabel),
    budgets,
    transactions,
    recurring,
    empty: everything[0] + everything[1] + projectsTotal === 0,
  };
}
