import type { EmployeeFact, MembershipFact } from "./facts";
import { round2 } from "./common";

/**
 * Manpower capacity from the team records: each active person is one full-time equivalent (FTE),
 * less the share of time their open project memberships take (ProjectMember.allocation, capped at
 * 100%). Nothing is assumed beyond those records.
 */

export type PersonLoad = { id: string; name: string; department: string; allocated: number; free: number; overAllocated: boolean };

export type DepartmentCapacity = {
  department: string;
  headcount: number;
  /** FTE taken by project work. */
  allocated: number;
  free: number;
  /** FTE per project id. */
  byProject: Map<string, number>;
  people: PersonLoad[];
};

export function personLoads(employees: EmployeeFact[], memberships: MembershipFact[]): PersonLoad[] {
  const sum = new Map<string, number>();
  for (const m of memberships) sum.set(m.employeeId, (sum.get(m.employeeId) ?? 0) + Math.max(0, m.allocation));
  return employees.map((e) => {
    const pct = sum.get(e.id) ?? 0;
    const allocated = Math.min(100, pct) / 100;
    return { id: e.id, name: e.name, department: e.department, allocated: round2(allocated), free: round2(1 - allocated), overAllocated: pct > 100 };
  });
}

/** Capacity of every department that has active people. */
export function departmentCapacity(employees: EmployeeFact[], memberships: MembershipFact[]): Map<string, DepartmentCapacity> {
  const loads = personLoads(employees, memberships);
  const deptOf = new Map(employees.map((e) => [e.id, e.department]));
  const out = new Map<string, DepartmentCapacity>();
  for (const p of loads) {
    const d: DepartmentCapacity = out.get(p.department) ?? { department: p.department, headcount: 0, allocated: 0, free: 0, byProject: new Map<string, number>(), people: [] };
    d.headcount += 1;
    d.allocated = round2(d.allocated + p.allocated);
    d.free = round2(d.free + p.free);
    d.people.push(p);
    out.set(p.department, d);
  }
  // Per-project FTE, scaled down for over-allocated people so a department never shows more than its headcount.
  const total = new Map<string, number>();
  for (const m of memberships) total.set(m.employeeId, (total.get(m.employeeId) ?? 0) + Math.max(0, m.allocation));
  for (const m of memberships) {
    const dept = deptOf.get(m.employeeId);
    const d = dept ? out.get(dept) : undefined;
    if (!d) continue;
    const t = total.get(m.employeeId) ?? 0;
    const share = t > 100 ? Math.max(0, m.allocation) / t : Math.max(0, m.allocation) / 100;
    d.byProject.set(m.projectId, round2((d.byProject.get(m.projectId) ?? 0) + share));
  }
  return out;
}

/** Average monthly salary of a department's active people; null when unknown or hidden. */
export function averageSalary(employees: EmployeeFact[], department: string): number | null {
  const pay = employees.filter((e) => e.department === department && e.monthlySalary !== null && e.monthlySalary > 0).map((e) => e.monthlySalary as number);
  return pay.length ? round2(pay.reduce((s, n) => s + n, 0) / pay.length) : null;
}
