import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, Project, ProjectMember } from "@/server/models";
import { addDays, monthKeyIST, startOfDayIST, startOfMonthIST, toDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { DEPARTMENTS, labelOf, type Department, type ProjectStatus } from "@/lib/constants";
import { MANPOWER_MONTHS } from "../constants";
import type { DepartmentLoad, ManpowerMonth, PersonLoad, ProjectManpower, RoleLoad } from "../types";

/**
 * Manpower outlook from project memberships: who is allocated how much of their time, now and on
 * work that has not started. Role requirements per project are not recorded, so demand here is
 * the allocations people already have, never an estimate of who else a project needs.
 *
 * A membership is current when its project is active or on hold and it has started; upcoming when
 * the project is still in planning or the membership starts later. Ended memberships, and those on
 * completed or cancelled projects, do not count. Department figures count active employees only
 * (people on leave are neither headcount nor demand), and spare capacity is taken at the busiest
 * month ahead, so work that ends before other work starts is not added together.
 */

const OPEN: ProjectStatus[] = ["planning", "active", "on_hold"];

type Membership = {
  employeeId: string;
  projectId: string;
  role: string;
  allocation: number;
  start: Date | null;
  end: Date | null;
  upcoming: boolean;
};

export type ManpowerOutlook = {
  people: PersonLoad[];
  departments: DepartmentLoad[];
  roles: RoleLoad[];
  projects: ProjectManpower[];
  months: ManpowerMonth[];
  /** Upcoming memberships whose project has no start date: left out of the month timeline. */
  undated: number;
  onLeave: number;
  /** Only for people who see salaries: monthly cost of all allocation above 100% at each person's pay. */
  excessMonthlyCost?: number;
};

/**
 * On a membership at instant `t` (an IST midnight). The end day is when the person leaves, so a
 * membership ending on the day another starts is a handoff, not two at once.
 */
const onAt = (m: Membership, t: number) => (!m.start || startOfDayIST(m.start).getTime() <= t) && (!m.end || startOfDayIST(m.end).getTime() > t);

/**
 * The highest combined allocation of these memberships at any one time between two instants. Load
 * only rises when a membership starts, so it is read at `from` and at every start inside the
 * period: work that ends before other work starts in the same month is not added together.
 */
function peakLoad(list: Membership[], from: Date, to: Date): number {
  const lo = from.getTime();
  const hi = to.getTime();
  const points = new Set([lo]);
  for (const m of list) {
    const t = m.start ? startOfDayIST(m.start).getTime() : null;
    if (t !== null && t > lo && t <= hi) points.add(t);
  }
  return Math.max(0, ...[...points].map((t) => list.reduce((s, m) => s + (onAt(m, t) ? m.allocation : 0), 0)));
}

export async function manpowerOutlook(options: { includeSalaries: boolean; now?: Date }): Promise<ManpowerOutlook> {
  await connectDB();
  const now = options.now ?? new Date();
  const today = startOfDayIST(now);
  const [employees, projects] = await Promise.all([
    Employee.find({ status: { $ne: "exited" } }, { name: 1, code: 1, designation: 1, department: 1, status: 1, monthlySalary: 1 }).sort({ name: 1 }).lean(),
    Project.find({ status: { $in: OPEN } }, { name: 1, code: 1, color: 1, status: 1, startDate: 1, endDate: 1 }).lean(),
  ]);
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const employeeIds = employees.map((e) => e._id);
  const raw = await ProjectMember.find(
    { employee: { $in: employeeIds }, project: { $in: projects.map((p) => p._id as Types.ObjectId) }, $or: [{ endDate: null }, { endDate: { $gte: today } }] },
    { project: 1, employee: 1, role: 1, allocation: 1, startDate: 1, endDate: 1 },
  ).lean();

  let undated = 0;
  const memberships: Membership[] = [];
  for (const m of raw) {
    const p = projectById.get(String(m.project));
    if (!p) continue;
    const start = m.startDate ?? p.startDate ?? null;
    // A membership ends on its own end date (the query already left out those that passed). The
    // project's planned end only bounds it while that end is ahead: an open project past its
    // planned end is still running, so its team stays on it with no known end.
    const projectEnd = p.endDate && startOfDayIST(p.endDate) >= today ? p.endDate : null;
    const end = m.endDate ?? projectEnd;
    const upcoming = p.status === "planning" || Boolean(start && startOfDayIST(start) > today);
    if (upcoming && !start) undated += 1;
    memberships.push({ employeeId: String(m.employee), projectId: String(p._id), role: m.role?.trim() || "Team member", allocation: m.allocation ?? 100, start, end, upcoming });
  }

  // Month windows from this month on; this month is read from today, the earlier days are past.
  const windows = Array.from({ length: MANPOWER_MONTHS }, (_, i) => {
    const from = startOfMonthIST(now, i);
    return { month: monthKeyIST(from), from: i === 0 ? today : from, to: addDays(startOfMonthIST(now, i + 1), -1) };
  });
  // Upcoming work with no start date has no place on a timeline.
  const dated = memberships.filter((m) => !(m.upcoming && !m.start));
  const datedOf = (ids: Set<string>) => dated.filter((m) => ids.has(m.employeeId));
  const loadIn = (employeeId: string, from: Date, to: Date) => peakLoad(datedOf(new Set([employeeId])), from, to);

  const people: PersonLoad[] = employees.map((e) => {
    const id = String(e._id);
    const mine = memberships.filter((m) => m.employeeId === id);
    const current = mine.filter((m) => !m.upcoming).reduce((s, m) => s + m.allocation, 0);
    const upcoming = mine.filter((m) => m.upcoming).reduce((s, m) => s + m.allocation, 0);
    const peak = Math.max(current, ...windows.map((w) => loadIn(id, w.from, w.to)));
    const person: PersonLoad = {
      id,
      name: e.name,
      code: e.code,
      designation: e.designation ?? null,
      department: e.department ?? "engineering",
      departmentLabel: labelOf(DEPARTMENTS, (e.department ?? "engineering") as Department),
      status: e.status ?? "active",
      current,
      upcoming,
      peak,
      projects: mine.map((m) => ({ id: m.projectId, name: projectById.get(m.projectId)?.name ?? "", role: m.role, allocation: m.allocation, upcoming: m.upcoming })),
    };
    if (options.includeSalaries) person.excessMonthlyCost = peak > 100 ? round2(((peak - 100) / 100) * (e.monthlySalary ?? 0)) : 0;
    return person;
  });
  const active = people.filter((p) => p.status === "active");

  const departments: DepartmentLoad[] = DEPARTMENTS.map((d) => {
    const inDept = active.filter((p) => p.department === d.value);
    const headcount = inDept.length;
    const currentFte = round2(inDept.reduce((s, p) => s + p.current, 0) / 100);
    const upcomingFte = round2(inDept.reduce((s, p) => s + p.upcoming, 0) / 100);
    // The busiest month ahead, current work included (undated upcoming work cannot be placed).
    const deptMemberships = datedOf(new Set(inDept.map((p) => p.id)));
    const busiest = Math.max(currentFte, ...windows.map((w) => peakLoad(deptMemberships, w.from, w.to) / 100));
    return {
      department: d.value,
      label: d.label,
      headcount,
      currentFte,
      upcomingFte,
      peakFte: round2(busiest),
      spareFte: round2(headcount - busiest),
      overAllocated: inDept.filter((p) => p.peak > 100).length,
    };
  }).filter((d) => d.headcount > 0 || d.currentFte > 0 || d.upcomingFte > 0);

  const roleMap = new Map<string, { people: Set<string>; current: number; upcoming: number; projects: Set<string> }>();
  for (const m of memberships) {
    const r = roleMap.get(m.role) ?? { people: new Set<string>(), current: 0, upcoming: 0, projects: new Set<string>() };
    r.people.add(m.employeeId);
    r.projects.add(m.projectId);
    if (m.upcoming) r.upcoming += m.allocation;
    else r.current += m.allocation;
    roleMap.set(m.role, r);
  }
  const roles: RoleLoad[] = [...roleMap.entries()]
    .map(([role, r]) => ({ role, people: r.people.size, currentFte: round2(r.current / 100), upcomingFte: round2(r.upcoming / 100), projects: r.projects.size }))
    .sort((a, b) => b.currentFte + b.upcomingFte - (a.currentFte + a.upcomingFte) || a.role.localeCompare(b.role));

  const projectRows: ProjectManpower[] = projects
    .map((p) => {
      const id = String(p._id);
      const team = memberships.filter((m) => m.projectId === id);
      return {
        id,
        name: p.name,
        code: p.code,
        color: p.color ?? "#4a82cc",
        status: p.status as ProjectStatus,
        startDate: p.startDate ? toDateInput(p.startDate) : null,
        endDate: p.endDate ? toDateInput(p.endDate) : null,
        members: new Set(team.map((m) => m.employeeId)).size,
        fte: round2(team.reduce((s, m) => s + m.allocation, 0) / 100),
        roles: [...new Set(team.map((m) => m.role))],
      };
    })
    .sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));

  // Set against active headcount, so only active people's allocations count.
  const activeMemberships = datedOf(new Set(active.map((p) => p.id)));
  const months: ManpowerMonth[] = windows.map((w) => ({
    month: w.month,
    demandFte: round2(peakLoad(activeMemberships, w.from, w.to) / 100),
    headcount: active.length,
    overPeople: active.filter((p) => loadIn(p.id, w.from, w.to) > 100).length,
  }));

  const out: ManpowerOutlook = {
    people,
    departments,
    roles,
    projects: projectRows,
    months,
    undated,
    onLeave: people.filter((p) => p.status === "on_leave").length,
  };
  if (options.includeSalaries) out.excessMonthlyCost = round2(people.reduce((s, p) => s + (p.excessMonthlyCost ?? 0), 0));
  return out;
}
