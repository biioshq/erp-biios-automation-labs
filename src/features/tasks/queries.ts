import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { Task, type TaskDoc } from "@/server/models";
import { idOf, iso } from "@/server/serialize";
import { getFiles } from "@/features/files/server";
import { listTeamMembers } from "@/server/services/users";
import { TASK_PRIORITIES, TASK_STATUSES, valuesOf, type TaskPriority, type TaskStatus } from "@/lib/constants";
import { addDays, dateRangeFilter, endOfDayIST, fromDateInput, isOverdue, startOfDayIST, startOfMonthIST } from "@/lib/dates";
import { formatDateShort } from "@/lib/format";
import { mongoSort, searchRegex, type ListParams, type Paginated } from "@/lib/list-params";
import { BOARD_LIMIT } from "./schemas";
import type { DashboardData, TaskComment, TaskDetail, TaskPerson, TaskRow } from "./types";

const OPEN_STATUSES: TaskStatus[] = ["pending", "in_progress", "review"];
const CLOSED_STATUSES: TaskStatus[] = ["completed", "cancelled"];
const DAY_MS = 24 * 60 * 60 * 1000;

const asFilter = (f: Record<string, unknown>) => f as QueryFilter<TaskDoc>;

type PopulatedUser = { _id: Types.ObjectId; name?: string; image?: string | null } | null | undefined;
type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string } | null | undefined;

const personOf = (u: PopulatedUser): TaskPerson | null =>
  u?._id ? { id: String(u._id), name: u.name ?? "Unknown", image: u.image ?? null } : null;

function toRow(t: TaskDoc & { project?: unknown; assignee?: unknown }, now = new Date()): TaskRow {
  const project = t.project as PopulatedProject;
  const status = t.status as TaskStatus;
  return {
    id: String(t._id),
    number: t.number,
    title: t.title,
    status,
    priority: (t.priority ?? "medium") as TaskPriority,
    dueDate: iso(t.dueDate),
    overdue: !CLOSED_STATUSES.includes(status) && isOverdue(t.dueDate, now),
    order: t.order ?? 0,
    project: project?._id ? { id: String(project._id), name: project.name, code: project.code, color: project.color ?? "#4a82cc" } : null,
    assignee: personOf(t.assignee as PopulatedUser),
    commentCount: t.comments?.length ?? 0,
    attachmentCount: t.attachments?.length ?? 0,
    completedAt: iso(t.completedAt),
    createdAt: iso(t.createdAt as Date)!,
    updatedAt: iso(t.updatedAt as Date)!,
  };
}

const objectIds = (values: string[]) => values.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

/** Mongo filter from list params. "overdue" is a derived status: due before today (IST) and still open. */
export function taskFilter(params: Pick<ListParams, "q" | "filters" | "from" | "to">, now = new Date()): QueryFilter<TaskDoc> {
  const and: Record<string, unknown>[] = [];
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    and.push({ $or: [{ title: re }, { number: re }, { description: re }] });
  }
  if (filters.status?.length) {
    const real = filters.status.filter((s) => (valuesOf(TASK_STATUSES) as string[]).includes(s));
    const overdue = {
      dueDate: { $lt: startOfDayIST(now) },
      status: { $nin: CLOSED_STATUSES },
    };
    const clauses: Record<string, unknown>[] = [];
    if (real.length) clauses.push({ status: { $in: real } });
    if (filters.status.includes("overdue")) clauses.push(overdue);
    if (clauses.length) and.push(clauses.length === 1 ? clauses[0]! : { $or: clauses });
    else and.push({ _id: null });
  }
  if (filters.priority?.length) {
    and.push({ priority: { $in: filters.priority.filter((p) => (valuesOf(TASK_PRIORITIES) as string[]).includes(p)) } });
  }
  if (filters.project?.length) {
    const ids = objectIds(filters.project);
    and.push({ project: { $in: filters.project.includes("none") ? [...ids, null] : ids } });
  }
  if (filters.assignee?.length) {
    const ids = objectIds(filters.assignee);
    and.push({ assignee: { $in: filters.assignee.includes("none") ? [...ids, null] : ids } });
  }
  const range = dateRangeFilter(params.from, params.to);
  if (range) and.push({ dueDate: range });
  return asFilter(and.length ? { $and: and } : {});
}

async function populateRows(filter: QueryFilter<TaskDoc>, sort: Record<string, 1 | -1>, limit: number, skip = 0) {
  return Task.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate("project", "name code color")
    .populate("assignee", "name image")
    .lean();
}

/** Priority, status and due date sort by meaning (urgent first, open before done, no due date last), not alphabetically. */
async function sortedPage(filter: QueryFilter<TaskDoc>, sort: { id: string; desc: boolean }, skip: number, limit: number) {
  const dir = sort.desc ? -1 : 1;
  const key =
    sort.id === "priority"
      ? { $indexOfArray: [valuesOf(TASK_PRIORITIES), "$priority"] }
      : sort.id === "status"
        ? { $indexOfArray: [valuesOf(TASK_STATUSES), "$status"] }
        : { $ifNull: ["$dueDate", dir === 1 ? new Date("9999-12-31") : new Date(0)] };
  const ids = await Task.aggregate<{ _id: Types.ObjectId }>([
    { $match: filter as Record<string, unknown> },
    { $addFields: { _k: key } },
    { $sort: { _k: dir, _id: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);
  const docs = await Task.find({ _id: { $in: ids.map((i) => i._id) } })
    .populate("project", "name code color")
    .populate("assignee", "name image")
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((i) => byId.get(String(i._id))).filter((d): d is NonNullable<typeof d> => Boolean(d));
}

export async function listTasks(params: ListParams): Promise<Paginated<TaskRow>> {
  await connectDB();
  const filter = taskFilter(params);
  const sort = params.sort ?? { id: "dueDate", desc: false };
  const skip = (params.page - 1) * params.pageSize;
  const [docs, total] = await Promise.all([
    ["priority", "status", "dueDate"].includes(sort.id)
      ? sortedPage(filter, sort, skip, params.pageSize)
      : populateRows(filter, mongoSort(sort), params.pageSize, skip),
    Task.countDocuments(filter),
  ]);
  const now = new Date();
  return { rows: docs.map((d) => toRow(d, now)), total, page: params.page, pageSize: params.pageSize };
}

/** Tasks for the Kanban board: the same filters as the table, capped at BOARD_LIMIT (most recently touched first). */
export async function listBoardTasks(params: ListParams): Promise<{ rows: TaskRow[]; total: number; limit: number }> {
  await connectDB();
  const filter = taskFilter({ ...params, from: params.from, to: params.to });
  const [docs, total] = await Promise.all([populateRows(filter, { updatedAt: -1, _id: -1 }, BOARD_LIMIT), Task.countDocuments(filter)]);
  const now = new Date();
  return { rows: docs.map((d) => toRow(d, now)), total, limit: BOARD_LIMIT };
}

/** "yyyy-mm" → the first and last grid days (Monday-first weeks) as "yyyy-mm-dd". */
export function calendarGrid(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const lead = (start.getUTCDay() + 6) % 7;
  const trail = 6 - ((end.getUTCDay() + 6) % 7);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return {
    first: day(new Date(start.getTime() - lead * DAY_MS)),
    last: day(new Date(end.getTime() + trail * DAY_MS)),
  };
}

/** Tasks due inside a month's calendar grid, with the same filters as the other views (the date range is the month). */
export async function listCalendarTasks(params: ListParams, month: string): Promise<{ rows: TaskRow[]; total: number }> {
  await connectDB();
  const grid = calendarGrid(month);
  const base = taskFilter({ ...params, from: null, to: null }) as Record<string, unknown>;
  const range = { $gte: fromDateInput(grid.first), $lte: endOfDayIST(fromDateInput(grid.last)) };
  const filter = asFilter({ $and: [base, { dueDate: range }] });
  const [docs, total] = await Promise.all([populateRows(filter, { dueDate: 1, _id: 1 }, 600), Task.countDocuments(filter)]);
  const now = new Date();
  return { rows: docs.map((d) => toRow(d, now)), total };
}

export async function getTask(id: string): Promise<TaskDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const t = await Task.findById(id)
    .populate("project", "name code color")
    .populate("assignee", "name image")
    .populate("createdBy", "name")
    .populate("comments.author", "name image")
    .lean();
  if (!t) return null;
  const files = await getFiles(t.attachments ?? []);
  const fileById = new Map(files.map((f) => [f.id, f]));
  const creator = t.createdBy as unknown as PopulatedUser;
  const comments: TaskComment[] = (t.comments ?? []).map((c) => ({
    id: String(c._id),
    body: c.body,
    createdAt: iso(c.createdAt as Date)!,
    author: personOf(c.author as unknown as PopulatedUser),
  }));
  return {
    ...toRow(t),
    description: t.description ?? null,
    attachments: (t.attachments ?? []).map((a) => fileById.get(String(a))).filter((f): f is NonNullable<typeof f> => Boolean(f)),
    comments,
    createdBy: creator?._id ? { id: idOf(creator._id)!, name: creator.name ?? "" } : null,
  };
}

/** Everything on the tasks dashboard in one round trip. */
export async function getTasksDashboard(userId: string): Promise<DashboardData> {
  await connectDB();
  const now = new Date();
  const today = startOfDayIST(now);
  const weekEnd = endOfDayIST(addDays(today, 6));
  const monthStart = startOfMonthIST(now);
  const tomorrow = addDays(today, 1);
  const open = { status: { $in: OPEN_STATUSES } };
  const me = new Types.ObjectId(userId);
  const pop = (q: ReturnType<typeof Task.find>) => q.populate("project", "name code color").populate("assignee", "name image");

  const [
    openCount,
    dueSoon,
    overdue,
    completedThisMonth,
    myOpen,
    statusRows,
    priorityRows,
    completedRecent,
    overdueDocs,
    dueSoonDocs,
    recentDocs,
    workloadRows,
    team,
  ] = await Promise.all([
    Task.countDocuments(asFilter(open)),
    Task.countDocuments(asFilter({ ...open, dueDate: { $gte: today, $lte: weekEnd } })),
    Task.countDocuments(asFilter({ ...open, dueDate: { $lt: today } })),
    Task.countDocuments(asFilter({ status: "completed", completedAt: { $gte: monthStart } })),
    Task.countDocuments(asFilter({ ...open, assignee: me })),
    Task.aggregate<{ _id: TaskStatus; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Task.aggregate<{ _id: TaskPriority; count: number }>([{ $match: open }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
    Task.find(asFilter({ status: "completed", completedAt: { $gte: addDays(tomorrow, -56) } }), { completedAt: 1 }).lean(),
    pop(Task.find(asFilter({ ...open, dueDate: { $lt: today } })).sort({ dueDate: 1 }).limit(6)).lean(),
    pop(Task.find(asFilter({ ...open, dueDate: { $gte: today, $lte: weekEnd } })).sort({ dueDate: 1, _id: 1 }).limit(6)).lean(),
    pop(Task.find(asFilter({ status: "completed" })).sort({ completedAt: -1 }).limit(6)).lean(),
    Task.aggregate<{ _id: Types.ObjectId | null; open: number; overdue: number }>([
      { $match: open },
      {
        $group: {
          _id: "$assignee",
          open: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $and: [{ $gt: ["$dueDate", null] }, { $lt: ["$dueDate", today] }] }, 1, 0] } },
        },
      },
    ]),
    listTeamMembers(),
  ]);

  const byStatus = valuesOf(TASK_STATUSES).map((status) => ({ status, count: statusRows.find((r) => r._id === status)?.count ?? 0 }));
  const byPriority = valuesOf(TASK_PRIORITIES).map((priority) => ({ priority, count: priorityRows.find((r) => r._id === priority)?.count ?? 0 }));

  const weeks = Array.from({ length: 8 }, (_, i) => ({
    label: formatDateShort(addDays(tomorrow, -(8 - i) * 7)),
    count: 0,
  }));
  for (const t of completedRecent) {
    if (!t.completedAt) continue;
    const bucket = Math.floor((tomorrow.getTime() - t.completedAt.getTime()) / (7 * DAY_MS));
    if (bucket >= 0 && bucket < 8) weeks[7 - bucket]!.count += 1;
  }

  const workloadBy = new Map(workloadRows.map((r) => [r._id ? String(r._id) : "none", r]));
  const workload: DashboardData["workload"] = team
    .map((m) => ({
      person: { id: m.id, name: m.name, image: m.image } as TaskPerson | null,
      open: workloadBy.get(m.id)?.open ?? 0,
      overdue: workloadBy.get(m.id)?.overdue ?? 0,
    }))
    .sort((a, b) => b.open - a.open);
  const unassigned = workloadBy.get("none");
  if (unassigned) workload.push({ person: null, open: unassigned.open, overdue: unassigned.overdue });

  return {
    open: openCount,
    dueSoon,
    overdue,
    completedThisMonth,
    myOpen,
    byStatus,
    byPriority,
    completedPerWeek: weeks,
    overdueTasks: overdueDocs.map((d) => toRow(d, now)),
    dueSoonTasks: dueSoonDocs.map((d) => toRow(d, now)),
    recentlyCompleted: recentDocs.map((d) => toRow(d, now)),
    workload,
  };
}
