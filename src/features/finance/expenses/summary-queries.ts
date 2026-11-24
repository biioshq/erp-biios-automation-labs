import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, Project } from "@/server/models";
import { salaryScope } from "@/server/auth/session";
import { getExpenseCategories } from "@/server/expense-categories";
import { COMPANY_EXPENSES } from "@/server/services/metrics";
import { directCategoryValues, expenseCategoryLabel } from "@/lib/expense-categories";
import { addDays, financialYearIST, fromDateInput, monthKeyIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { TIME_ZONE, round2 } from "@/lib/format";
import { expenseListFilter } from "./queries";
import { PAID_EXPR, statusExpr } from "./payment-status";

/**
 * The Expense summary (/finance/expenses/summary): expenses recorded in a date range, by day,
 * month, financial year, category, project and vendor, with what is paid and what is still owed.
 * It counts exactly the rows the Expenses list totals count for the same dates (company expenses:
 * stock counted at purchase is left out, and members do not see salaries), so the two agree.
 */

export type SummaryTotals = { count: number; total: number; tax: number };
export type DayPoint = { day: string; total: number };
/** A month's expenses split by nature; direct + indirect is the month's total. */
export type MonthPoint = { month: string; total: number; direct: number; indirect: number };
export type YearPoint = { label: string; startYear: number; total: number; count: number };
export type Slice = { key: string; label: string; total: number; count: number };

export type PaymentSplit = {
  /** Paid so far on these expenses (explicit payments, or the whole amount when paid on the expense date). */
  paid: number;
  /** Still owed, by status as of today. */
  unpaid: number;
  partial: number;
  overdue: number;
  /** Generated stock assignments: a cost, but no payment of their own (paid when the stock was bought). */
  fromStock: number;
  openCount: number;
};

export type ExpenseSummaryData = {
  from: string | null;
  to: string | null;
  totals: SummaryTotals;
  daily: DayPoint[];
  monthly: MonthPoint[];
  /** True when the range has more months than the chart shows (the latest are kept). */
  monthlyTrimmed: boolean;
  /** Every financial year with expenses, over all records (not limited by the date range). */
  yearly: YearPoint[];
  byCategory: Slice[];
  byProject: Slice[];
  byVendor: Slice[];
  vendorCount: number;
  payments: PaymentSplit;
  nature: NatureSplit;
};

export type NatureSplit = {
  direct: number;
  indirect: number;
  directCount: number;
  indirectCount: number;
  /**
   * Stock used on projects that was counted at purchase, by nature: not in the totals or counts above,
   * but the Expenses list filtered to that nature shows these rows too (outside its totals).
   */
  directCountedAtPurchase: number;
  indirectCountedAtPurchase: number;
};

/**
 * The page's range: the given days, or this financial year to date. Reversed days are swapped,
 * so a hand-typed URL still shows something sensible.
 */
export function expenseSummaryRange(from: string | null, to: string | null, now = new Date()): { from: string; to: string } {
  const f = from ?? toDateInput(financialYearIST(now).start);
  const t = to ?? toDateInput(now);
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

const MAX_MONTHS = 36;
const DAILY_DAYS = 31;
const TOP_VENDORS = 12;

type Group = { _id: string | null; total: number; count: number };

type Facet = {
  totals: { count: number; total: number; tax: number }[];
  daily: Group[];
  monthly: { _id: { month: string; nature: string }; total: number }[];
  byCategory: Group[];
  byProject: { _id: Types.ObjectId | null; total: number; count: number }[];
  byVendor: Group[];
  vendorCount: { n: number }[];
  payments: { _id: string; amount: number; paid: number; count: number }[];
  nature: Group[];
};

const day = (field: string, format: string) => ({ $dateToString: { format, date: field, timezone: TIME_ZONE } });

/** Every day from `from` to `to` (both "yyyy-mm-dd"), as keys. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = fromDateInput(from); toDateInput(d) <= to && out.length < 400; d = addDays(d, 1)) out.push(toDateInput(d));
  return out;
}

/** Every month key from `from` to `to` ("yyyy-mm"). */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = fromDateInput(`${from}-01`); monthKeyIST(m) <= to && out.length < 1200; m = startOfMonthIST(m, 1)) out.push(monthKeyIST(m));
  return out;
}

export async function getExpenseSummary(range: { from: string | null; to: string | null }, now = new Date()): Promise<ExpenseSummaryData> {
  await connectDB();
  const [scope, base, categories] = await Promise.all([
    salaryScope(),
    expenseListFilter({ q: "", filters: {}, from: range.from, to: range.to }, now),
    getExpenseCategories(),
  ]);
  const match = { $and: [base, COMPANY_EXPENSES, ...(Object.keys(scope).length ? [scope] : [])] };
  const today = toDateInput(now);
  const lastDay = range.to && range.to < today ? range.to : today;
  const firstDaily = toDateInput(addDays(fromDateInput(lastDay), -(DAILY_DAYS - 1)));
  const dailyFrom = range.from && range.from > firstDaily ? range.from : firstDaily;
  // expenseNature(): on a project is direct, otherwise the category's setting decides.
  const direct = directCategoryValues(categories);
  const natureExpr = { $cond: [{ $or: [{ $ne: [{ $ifNull: ["$project", null] }, null] }, { $in: ["$category", direct] }] }, "direct", "indirect"] };

  const [facet] = await Expense.aggregate<Facet>([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              total: { $sum: "$amount" },
              tax: { $sum: { $add: [{ $ifNull: ["$gst.cgst", 0] }, { $ifNull: ["$gst.sgst", 0] }, { $ifNull: ["$gst.igst", 0] }, { $ifNull: ["$gst.cess", 0] }] } },
            },
          },
        ],
        daily: [
          { $match: { date: { $gte: fromDateInput(dailyFrom), $lt: addDays(fromDateInput(lastDay), 1) } } },
          { $group: { _id: day("$date", "%Y-%m-%d"), total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ],
        monthly: [{ $group: { _id: { month: day("$date", "%Y-%m"), nature: natureExpr }, total: { $sum: "$amount" } } }],
        byCategory: [{ $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }],
        byProject: [{ $group: { _id: { $ifNull: ["$project", null] }, total: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }],
        byVendor: [{ $group: { _id: "$vendor", total: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { total: -1, _id: 1 } }, { $limit: TOP_VENDORS }],
        vendorCount: [{ $group: { _id: "$vendor" } }, { $count: "n" }],
        payments: [
          {
            $group: {
              _id: {
                $cond: [{ $and: [{ $eq: ["$paymentMethod", "stock"] }, { $not: [{ $isArray: "$payments" }] }] }, "stock", statusExpr(now)],
              },
              amount: { $sum: "$amount" },
              // Capped at the amount, so a rounding surplus never shows as more paid than spent.
              paid: { $sum: { $min: ["$amount", PAID_EXPR] } },
              count: { $sum: 1 },
            },
          },
        ],
        nature: [{ $group: { _id: natureExpr, total: { $sum: "$amount" }, count: { $sum: 1 } } }],
      },
    },
  ]);
  const [yearly, countedAtPurchase] = await Promise.all([
    yearlyTotals(scope),
    // The rows the Expenses list shows for each nature on top of the ones counted here.
    Expense.aggregate<Group>([
      { $match: { $and: [base, { countedAtPurchase: true }, ...(Object.keys(scope).length ? [scope] : [])] } },
      { $group: { _id: natureExpr, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  const listedExtra = (n: string) => countedAtPurchase.find((x) => x._id === n)?.count ?? 0;

  const projectIds = (facet?.byProject ?? []).map((p) => p._id).filter((id): id is Types.ObjectId => Boolean(id));
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { name: 1, code: 1 }).lean() : [];
  const projectName = new Map(projects.map((p) => [String(p._id), p.name]));

  // Daily: every day of the window, zero-filled.
  const dailyTotals = new Map((facet?.daily ?? []).map((d) => [d._id ?? "", round2(d.total)]));
  const daily = dailyFrom <= lastDay ? daysBetween(dailyFrom, lastDay).map((d) => ({ day: d, total: dailyTotals.get(d) ?? 0 })) : [];

  // Monthly: from the range start (or the first expense) to its end (or this month), zero-filled.
  const monthTotals = new Map<string, { direct: number; indirect: number }>();
  for (const m of facet?.monthly ?? []) {
    const entry = monthTotals.get(m._id.month) ?? { direct: 0, indirect: 0 };
    entry[m._id.nature === "direct" ? "direct" : "indirect"] += m.total;
    monthTotals.set(m._id.month, entry);
  }
  const knownMonths = [...monthTotals.keys()].sort();
  const firstMonth = range.from?.slice(0, 7) ?? knownMonths[0];
  const lastMonth = lastDay.slice(0, 7) >= (knownMonths.at(-1) ?? "") ? lastDay.slice(0, 7) : knownMonths.at(-1)!;
  const allMonths = firstMonth ? monthsBetween(firstMonth, lastMonth) : [];
  const monthly = allMonths.slice(-MAX_MONTHS).map((m) => {
    const t = monthTotals.get(m);
    const directPart = round2(t?.direct ?? 0);
    const indirectPart = round2(t?.indirect ?? 0);
    return { month: m, total: round2(directPart + indirectPart), direct: directPart, indirect: indirectPart };
  });

  const status = (s: string) => facet?.payments.find((p) => p._id === s);
  const owed = (s: string) => round2((status(s)?.amount ?? 0) - (status(s)?.paid ?? 0));
  const paid = round2((facet?.payments ?? []).filter((p) => p._id !== "stock").reduce((sum, p) => sum + p.paid, 0));
  const nature = (n: string) => facet?.nature.find((x) => x._id === n);

  return {
    from: range.from,
    to: range.to,
    totals: { count: facet?.totals[0]?.count ?? 0, total: round2(facet?.totals[0]?.total ?? 0), tax: round2(facet?.totals[0]?.tax ?? 0) },
    daily,
    monthly,
    monthlyTrimmed: allMonths.length > MAX_MONTHS,
    yearly,
    byCategory: (facet?.byCategory ?? []).map((c) => ({ key: c._id ?? "", label: expenseCategoryLabel(categories, c._id), total: round2(c.total), count: c.count })),
    byProject: (facet?.byProject ?? []).map((p) => ({
      // A project deleted since has no list filter to link to; its key says so.
      key: !p._id ? "none" : projectName.has(String(p._id)) ? String(p._id) : `deleted:${String(p._id)}`,
      label: p._id ? (projectName.get(String(p._id)) ?? "Deleted project") : "Company overhead (no project)",
      total: round2(p.total),
      count: p.count,
    })),
    byVendor: (facet?.byVendor ?? []).map((v) => ({ key: v._id ?? "", label: v._id ?? "", total: round2(v.total), count: v.count })),
    vendorCount: facet?.vendorCount[0]?.n ?? 0,
    payments: {
      paid,
      unpaid: owed("unpaid"),
      partial: owed("partial"),
      overdue: owed("overdue"),
      fromStock: round2(status("stock")?.amount ?? 0),
      openCount: ["unpaid", "partial", "overdue"].reduce((n, s) => n + (status(s)?.count ?? 0), 0),
    },
    nature: {
      direct: round2(nature("direct")?.total ?? 0),
      indirect: round2(nature("indirect")?.total ?? 0),
      directCount: nature("direct")?.count ?? 0,
      indirectCount: nature("indirect")?.count ?? 0,
      directCountedAtPurchase: listedExtra("direct"),
      indirectCountedAtPurchase: listedExtra("indirect"),
    },
  };
}

/**
 * Expenses per Indian financial year (April to March) over every record, so the table compares
 * whole years whatever range the page shows. Same rows as the list totals: company expenses only.
 */
async function yearlyTotals(scope: Record<string, unknown>): Promise<YearPoint[]> {
  const match = { $and: [COMPANY_EXPENSES, ...(Object.keys(scope).length ? [scope] : [])] };
  const rows = await Expense.aggregate<{ _id: number; total: number; count: number }>([
    { $match: match },
    {
      $group: {
        // Jan to Mar belong to the financial year that started the April before.
        _id: {
          $let: {
            vars: { y: { $year: { date: "$date", timezone: TIME_ZONE } }, m: { $month: { date: "$date", timezone: TIME_ZONE } } },
            in: { $cond: [{ $gte: ["$$m", 4] }, "$$y", { $subtract: ["$$y", 1] }] },
          },
        },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: -1 } },
  ]);
  return rows.map((y) => ({
    startYear: y._id,
    label: financialYearIST(fromDateInput(`${y._id}-04-01`)).label,
    total: round2(y.total),
    count: y.count,
  }));
}
