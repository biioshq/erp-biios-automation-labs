import "server-only";

import { Types, type QueryFilter } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, Expense, ProjectMember, RecurringExpense, Task, User, type EmployeeDoc, type RecurringExpenseDoc } from "@/server/models";
import { getCurrentUser } from "@/server/auth/session";
import { listTeamMembers } from "@/server/services/users";
import { iso } from "@/server/serialize";
import { financialYearIST } from "@/lib/dates";
import { searchRegex, type ListParams } from "@/lib/list-params";
import type { Department, EmployeeStatus, EmploymentType } from "@/lib/constants";
import { currentMembership, isCurrentMembership } from "./membership";
import type {
  EmployeeDetail,
  EmployeePageData,
  EmployeeProjectChip,
  EmployeeRow,
  EmployeeSummary,
  MembershipDTO,
  UserLinkOption,
} from "./types";

const STATUS_RANK: Record<string, number> = { active: 0, on_leave: 1, exited: 2 };
const FALLBACK_COLOR = "#4a82cc";

type PopulatedProject = { _id: Types.ObjectId; name: string; code: string; color?: string; status: string };

export async function isAdminViewer(): Promise<boolean> {
  return (await getCurrentUser())?.role === "admin";
}

/** Open memberships grouped by employee, as chips with the project's colour. */
async function currentProjectsFor(employeeIds: Types.ObjectId[]): Promise<Map<string, EmployeeProjectChip[]>> {
  const out = new Map<string, EmployeeProjectChip[]>();
  if (!employeeIds.length) return out;
  const memberships = await ProjectMember.find({ employee: { $in: employeeIds }, ...currentMembership() })
    .populate("project", "name code color status")
    .lean();
  for (const m of memberships) {
    const project = m.project as unknown as PopulatedProject | null;
    if (!project?._id) continue;
    const key = String(m.employee);
    const list = out.get(key) ?? [];
    list.push({ id: String(project._id), name: project.name, color: project.color ?? FALLBACK_COLOR, allocation: m.allocation ?? 0 });
    out.set(key, list);
  }
  return out;
}

function toRow(e: EmployeeDoc, projects: EmployeeProjectChip[], isAdmin: boolean): EmployeeRow {
  return {
    id: String(e._id),
    code: e.code,
    name: e.name,
    email: e.email ?? null,
    phone: e.phone ?? null,
    designation: e.designation ?? null,
    department: (e.department ?? "engineering") as Department,
    employmentType: (e.employmentType ?? "full_time") as EmploymentType,
    status: (e.status ?? "active") as EmployeeStatus,
    joinDate: iso(e.joinDate),
    exitDate: iso(e.exitDate),
    // Members never receive salary figures.
    monthlySalary: isAdmin ? (e.monthlySalary ?? 0) : null,
    skills: e.skills ?? [],
    hasAccount: Boolean(e.user),
    projects,
    allocationTotal: projects.reduce((sum, p) => sum + p.allocation, 0),
  };
}

/** Mongo filter from the list params. */
function employeeFilter(params: Pick<ListParams, "q" | "filters">): QueryFilter<EmployeeDoc> {
  const filter: Record<string, unknown> = {};
  const { q, filters } = params;
  if (q) {
    const re = searchRegex(q);
    filter.$or = [{ name: re }, { code: re }, { email: re }, { designation: re }, { skills: re }, { phone: re }];
  }
  if (filters.department?.length) filter.department = { $in: filters.department };
  if (filters.status?.length) filter.status = { $in: filters.status };
  if (filters.employmentType?.length) filter.employmentType = { $in: filters.employmentType };
  return filter as QueryFilter<EmployeeDoc>;
}

export async function listEmployees(params: ListParams): Promise<EmployeeRow[]> {
  await connectDB();
  const isAdmin = await isAdminViewer();
  const docs = await Employee.find(employeeFilter(params)).sort({ name: 1 }).limit(500).lean();
  const chips = await currentProjectsFor(docs.map((d) => d._id));
  return docs
    .map((d) => toRow(d, chips.get(String(d._id)) ?? [], isAdmin))
    .sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || a.name.localeCompare(b.name));
}

/** KPI strip: whole company, not the filtered list. */
export async function getEmployeeSummary(): Promise<EmployeeSummary> {
  await connectDB();
  const isAdmin = await isAdminViewer();
  const [byStatus, departments, onProjects, payroll] = await Promise.all([
    Employee.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Employee.distinct("department", { status: { $ne: "exited" } }),
    ProjectMember.aggregate<{ n: number }>([
      { $match: currentMembership() },
      { $group: { _id: "$employee" } },
      { $lookup: { from: "employees", localField: "_id", foreignField: "_id", as: "e" } },
      { $match: { "e.status": { $in: ["active", "on_leave"] } } },
      { $count: "n" },
    ]),
    isAdmin
      ? Employee.aggregate<{ total: number }>([
          { $match: { status: { $ne: "exited" } } },
          { $group: { _id: null, total: { $sum: "$monthlySalary" } } },
        ])
      : Promise.resolve(null),
  ]);
  const count = (s: string) => byStatus.find((r) => r._id === s)?.n ?? 0;
  return {
    headcount: count("active") + count("on_leave"),
    onLeave: count("on_leave"),
    onProjects: onProjects[0]?.n ?? 0,
    payroll: isAdmin ? (payroll?.[0]?.total ?? 0) : null,
    departments: departments.length,
  };
}

/**
 * The schedule linked on the employee, while it is still their salary schedule. An admin can move a schedule to
 * someone else or to another category on the Recurring page; the stale link must not take it back. Older schedules
 * made before they named the employee have no employee and still count.
 */
export function linkedSalarySchedule(employeeId: Types.ObjectId, linkedId: Types.ObjectId): QueryFilter<RecurringExpenseDoc> {
  return { _id: linkedId, category: "salaries", $or: [{ employee: employeeId }, { employee: null }] };
}

/**
 * The employee's salary schedules: the one linked on the employee (even if ended), then any live "salaries"
 * schedule that names them, such as one made from the Salary template on the Recurring page. Linked first,
 * then oldest first, so callers can treat the first live one as the employee's salary schedule.
 */
export async function salarySchedulesFor(employeeId: Types.ObjectId, linkedId?: Types.ObjectId | null) {
  const list = await RecurringExpense.find({
    $or: [...(linkedId ? [linkedSalarySchedule(employeeId, linkedId)] : []), { employee: employeeId, category: "salaries", status: { $ne: "ended" } }],
  })
    .sort({ createdAt: 1 })
    .lean();
  const linked = linkedId ? list.filter((s) => String(s._id) === String(linkedId)) : [];
  return [...linked, ...list.filter((s) => !linkedId || String(s._id) !== String(linkedId))];
}

/** The schedule that pays the employee: the first live one, else the linked one. */
export function primarySalarySchedule<T extends { status?: string | null }>(schedules: T[]): T | null {
  return schedules.find((s) => s.status !== "ended") ?? schedules[0] ?? null;
}

/** Everything the form needs for one employee. Salary fields are stripped for members. */
export async function getEmployee(id: string): Promise<EmployeeDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const isAdmin = await isAdminViewer();
  const e = await Employee.findById(id).lean();
  if (!e) return null;
  const chips = await currentProjectsFor([e._id]);
  // A schedule made on the Recurring page for this person counts too, so "Pay salary" shows it and no second one is made.
  const schedule = isAdmin ? primarySalarySchedule(await salarySchedulesFor(e._id, e.salaryRecurring)) : null;
  return {
    ...toRow(e, chips.get(String(e._id)) ?? [], isAdmin),
    notes: e.notes ?? null,
    userId: e.user ? String(e.user) : null,
    salaryRecurringId: schedule ? String(schedule._id) : null,
    paysSalary: schedule?.status === "active",
    updatedAt: iso(e.updatedAt as Date)!,
  };
}

/** Sign-in accounts for the "link account" picker, marking the ones another employee already uses. */
export async function getUserLinkOptions(): Promise<UserLinkOption[]> {
  await connectDB();
  const [users, linked] = await Promise.all([listTeamMembers(), Employee.find({ user: { $ne: null } }, { user: 1 }).lean()]);
  const linkedTo = new Map(linked.map((l) => [String(l.user), String(l._id)]));
  return users.map((u) => ({ value: u.id, label: u.name, description: u.email, linkedEmployeeId: linkedTo.get(u.id) ?? null }));
}

function toMembership(m: {
  _id: Types.ObjectId;
  project: unknown;
  role?: string | null;
  allocation?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}): MembershipDTO | null {
  const p = m.project as PopulatedProject | null;
  if (!p?._id) return null;
  return {
    id: String(m._id),
    project: { id: String(p._id), name: p.name, code: p.code, color: p.color ?? FALLBACK_COLOR, status: p.status },
    role: m.role ?? "Team member",
    allocation: m.allocation ?? 0,
    startDate: iso(m.startDate),
    endDate: iso(m.endDate),
  };
}

/** The detail page: employee, projects, salary (admins), linked account and tasks. */
export async function getEmployeePage(id: string): Promise<EmployeePageData | null> {
  const employee = await getEmployee(id);
  if (!employee) return null;
  const isAdmin = await isAdminViewer();
  const oid = new Types.ObjectId(id);
  const fy = financialYearIST();

  const [memberships, schedule, payments, paidAgg, user] = await Promise.all([
    ProjectMember.find({ employee: oid }).populate("project", "name code color status").sort({ startDate: -1 }).lean(),
    isAdmin && employee.salaryRecurringId ? RecurringExpense.findById(employee.salaryRecurringId).lean() : null,
    isAdmin ? Expense.find({ employee: oid }).sort({ date: -1 }).limit(12).lean() : [],
    isAdmin
      ? Expense.aggregate<{ total: number }>([
          { $match: { employee: oid, date: { $gte: fy.start, $lte: fy.end } } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ])
      : [],
    employee.userId ? User.findById(employee.userId, { name: 1, email: 1 }).lean() : null,
  ]);

  const all = memberships.map(toMembership).filter((m): m is MembershipDTO => m !== null);
  const current = all.filter((m) => isCurrentMembership(m.endDate));
  const past = all.filter((m) => !isCurrentMembership(m.endDate));

  let tasks: EmployeePageData["tasks"] = null;
  if (user) {
    const [total, open] = await Promise.all([
      Task.countDocuments({ assignee: user._id }),
      Task.countDocuments({ assignee: user._id, status: { $nin: ["completed", "cancelled"] } }),
    ]);
    tasks = { open, total };
  }

  return {
    employee,
    current,
    past,
    salary: isAdmin
      ? {
          monthlySalary: employee.monthlySalary ?? 0,
          scheduleId: schedule ? String(schedule._id) : null,
          scheduleStatus: (schedule?.status as "active" | "paused" | "ended" | undefined) ?? null,
          nextPayDate: schedule && schedule.status === "active" ? iso(schedule.nextRunDate) : null,
          payments: payments.map((p) => ({
            id: String(p._id),
            number: p.number,
            date: iso(p.date)!,
            amount: p.amount,
            description: p.description ?? null,
          })),
          paidThisYear: paidAgg[0]?.total ?? 0,
          yearLabel: fy.label,
        }
      : null,
    linkedUser: user ? { id: String(user._id), name: user.name ?? user.email ?? "Unknown", email: user.email ?? "" } : null,
    tasks,
  };
}

/** Counts of people on each project (open memberships), for lists and badges elsewhere. */
export async function getEmployeeProjectCounts(projectIds?: string[]): Promise<Record<string, number>> {
  await connectDB();
  const match: Record<string, unknown> = currentMembership();
  if (projectIds?.length) match.project = { $in: projectIds.filter((p) => Types.ObjectId.isValid(p)).map((p) => new Types.ObjectId(p)) };
  const rows = await ProjectMember.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: match },
    { $group: { _id: "$project", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

/** Projects each person works on now, keyed by employee id (for cards elsewhere). */
export async function getCurrentProjectsByEmployee(employeeIds: string[]): Promise<Record<string, EmployeeProjectChip[]>> {
  await connectDB();
  const ids = employeeIds.filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
  return Object.fromEntries(await currentProjectsFor(ids));
}


/** True when at least one employee exists, so the list can tell "empty" from "nothing matches". */
export async function hasEmployees(): Promise<boolean> {
  await connectDB();
  return Boolean(await Employee.exists({}));
}
