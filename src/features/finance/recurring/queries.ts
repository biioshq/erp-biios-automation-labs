import { salaryScope } from "@/server/auth/session";
import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { Expense, RecurringExpense, type RecurringExpenseDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { addDays, startOfDayIST } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { monthlyEquivalent, upcomingOccurrences } from "@/lib/recurrence";
import type { ExpenseCategory, PaymentMethod, ProjectStage, RecurringFrequency, RecurringStatus } from "@/lib/constants";
import { GROUP_CATEGORIES } from "./schemas";
import type { PostedExpense, RecurringDetail, RecurringRow, RecurringSummary } from "./types";

type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null;
type PopulatedEmployee = { _id: Types.ObjectId; name: string } | null;

function toRow(t: RecurringExpenseDoc & { project?: unknown; employee?: unknown }): RecurringRow {
  const project = t.project as PopulatedProject;
  const employee = t.employee as PopulatedEmployee;
  const frequency = t.frequency as RecurringFrequency;
  return {
    id: String(t._id),
    code: t.code,
    name: t.name,
    vendor: t.vendor,
    category: t.category as ExpenseCategory,
    amount: t.amount,
    gstRate: t.gstRate ?? 0,
    frequency,
    dayOfMonth: t.dayOfMonth ?? 1,
    startDate: iso(t.startDate)!,
    endDate: iso(t.endDate),
    nextRunDate: iso(t.nextRunDate)!,
    lastRunDate: iso(t.lastRunDate),
    status: t.status as RecurringStatus,
    occurrences: t.occurrences ?? 0,
    monthly: round2(monthlyEquivalent(t.amount, frequency)),
    project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? "#4a82cc" } : null,
    stage: (t.stage as ProjectStage | undefined) ?? null,
    employee: employee?._id ? { id: String(employee._id), name: employee.name } : null,
  };
}

/** Mongo filter from list params. `group` is the tab: a category group, or paused / ended. */
export function recurringFilter(params: Pick<ListParams, "q" | "filters">): QueryFilter<RecurringExpenseDoc> {
  // Built loosely: Mongoose 9's strict filter types reject `$in` over string lists from the URL.
  const filter: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    filter.$or = [{ name: re }, { vendor: re }, { code: re }, { description: re }];
  }
  if (filters.category?.length) filter.category = { $in: filters.category };
  if (filters.status?.length) filter.status = { $in: filters.status };
  if (filters.frequency?.length) filter.frequency = { $in: filters.frequency };
  if (filters.project?.length) {
    const ids = filters.project.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const none = filters.project.includes("none");
    filter.project = none ? { $in: [...ids, null] } : { $in: ids };
  }
  const group = filters.group?.[0];
  if (group === "paused" || group === "ended") and.push({ status: group });
  else if (group && group in GROUP_CATEGORIES) and.push({ category: { $in: GROUP_CATEGORIES[group as keyof typeof GROUP_CATEGORIES] } });
  if (and.length) filter.$and = and;
  return filter as QueryFilter<RecurringExpenseDoc>;
}

export async function listRecurring(params: ListParams): Promise<Paginated<RecurringRow>> {
  await connectDB();
  const scope = await salaryScope();
  const filter = (Object.keys(scope).length ? { $and: [recurringFilter(params), scope] } : recurringFilter(params)) as ReturnType<typeof recurringFilter>;
  const [docs, total] = await Promise.all([
    RecurringExpense.find(filter)
      .sort(mongoSort(params.sort ?? { id: "nextRunDate", desc: false }))
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .populate("project", "name code color")
      .populate("employee", "name")
      .lean(),
    RecurringExpense.countDocuments(filter),
  ]);
  return { rows: docs.map(toRow), total, page: params.page, pageSize: params.pageSize };
}

/** KPI numbers and tab counts. Schedules are few, so this reads them all once. */
export async function getRecurringSummary(now: Date = new Date()): Promise<RecurringSummary> {
  await connectDB();
  const docs = await RecurringExpense.find(
    await salaryScope(),
    { category: 1, amount: 1, frequency: 1, dayOfMonth: 1, nextRunDate: 1, endDate: 1, status: 1 },
  ).lean();
  const horizon = addDays(startOfDayIST(now), 30);
  const summary: RecurringSummary = {
    committedMonthly: 0,
    salariesMonthly: 0,
    dueCount: 0,
    dueAmount: 0,
    pausedCount: 0,
    activeCount: 0,
    groupCounts: { all: docs.length, salaries: 0, bills: 0, subscriptions: 0, paused: 0, ended: 0 },
    total: docs.length,
  };
  for (const t of docs) {
    const category = t.category as ExpenseCategory;
    for (const [group, categories] of Object.entries(GROUP_CATEGORIES)) {
      if ((categories as ExpenseCategory[]).includes(category)) summary.groupCounts[group]++;
    }
    if (t.status === "paused") {
      summary.pausedCount++;
      summary.groupCounts.paused++;
    }
    if (t.status === "ended") summary.groupCounts.ended++;
    if (t.status !== "active") continue;
    summary.activeCount++;
    const frequency = t.frequency as RecurringFrequency;
    const monthly = monthlyEquivalent(t.amount, frequency);
    summary.committedMonthly += monthly;
    if (category === "salaries") summary.salariesMonthly += monthly;
    // Overdue dates count too: the scheduler posts them on its next run.
    const dates = upcomingOccurrences(t.nextRunDate, frequency, t.dayOfMonth ?? 1, 36, t.endDate).filter(
      (d) => d.getTime() <= horizon.getTime(),
    );
    summary.dueCount += dates.length;
    summary.dueAmount += dates.length * t.amount;
  }
  summary.committedMonthly = round2(summary.committedMonthly);
  summary.salariesMonthly = round2(summary.salariesMonthly);
  summary.dueAmount = round2(summary.dueAmount);
  return summary;
}

export async function getRecurring(id: string): Promise<RecurringDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const t = await RecurringExpense.findById(id)
    .populate("project", "name code color")
    .populate("employee", "name")
    .populate("createdBy", "name")
    .lean();
  if (!t) return null;
  if (t.category === "salaries" && Object.keys(await salaryScope()).length) return null;

  const [postedDocs, totals] = await Promise.all([
    Expense.find({ recurring: t._id }, { number: 1, date: 1, amount: 1 }).sort({ date: -1, _id: -1 }).limit(60).lean(),
    Expense.aggregate<{ total: number; count: number }>([
      { $match: { recurring: t._id } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  const posted: PostedExpense[] = postedDocs.map((e) => ({ id: String(e._id), number: e.number, date: iso(e.date)!, amount: e.amount }));
  const creator = t.createdBy as unknown as { _id: Types.ObjectId; name?: string } | null;
  const row = toRow(t);
  const upcoming =
    t.status === "ended"
      ? []
      : upcomingOccurrences(t.nextRunDate, t.frequency as RecurringFrequency, t.dayOfMonth ?? 1, 6, t.endDate).map((d) => iso(d)!);

  return {
    ...row,
    description: t.description ?? null,
    gstin: t.gstin ?? null,
    hsnSac: t.hsnSac ?? null,
    paymentMethod: (t.paymentMethod ?? "bank_transfer") as PaymentMethod,
    notes: t.notes ?? null,
    upcoming,
    posted,
    postedTotal: round2(totals[0]?.total ?? 0),
    postedCount: totals[0]?.count ?? 0,
    createdBy: creator?._id ? { id: idOf(creator._id)!, name: creator.name ?? "" } : null,
    createdAt: iso(t.createdAt as Date)!,
    updatedAt: iso(t.updatedAt as Date)!,
  };
}
