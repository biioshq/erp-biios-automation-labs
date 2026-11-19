import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/server/db";
import { Employee, ProjectMember } from "@/server/models";
import { getEmployeeOptions } from "@/server/lookups";
import { iso } from "@/server/serialize";
import type { Department, EmployeeStatus } from "@/lib/constants";
import { currentMembership, isCurrentMembership } from "./membership";
import type { TeamData, TeamMemberDTO } from "./types";

type PopulatedEmployee = {
  _id: Types.ObjectId;
  name: string;
  code: string;
  designation?: string;
  department?: string;
  status?: string;
};

/** A project's team: current members, past members, total allocation and who can still be added. */
export async function getProjectTeam(projectId: string): Promise<TeamData> {
  if (!Types.ObjectId.isValid(projectId)) return { current: [], past: [], totalAllocation: 0, options: [] };
  await connectDB();
  const pid = new Types.ObjectId(projectId);
  const [memberships, options] = await Promise.all([
    ProjectMember.find({ project: pid }).populate("employee", "name code designation department status").sort({ startDate: 1, createdAt: 1 }).lean(),
    getEmployeeOptions(),
  ]);

  const members: TeamMemberDTO[] = [];
  for (const m of memberships) {
    const e = m.employee as unknown as PopulatedEmployee | null;
    if (!e?._id) continue;
    members.push({
      id: String(m._id),
      employee: {
        id: String(e._id),
        name: e.name,
        code: e.code,
        designation: e.designation ?? null,
        department: (e.department ?? "engineering") as Department,
        status: (e.status ?? "active") as EmployeeStatus,
      },
      role: m.role ?? "Team member",
      allocation: m.allocation ?? 0,
      startDate: iso(m.startDate),
      endDate: iso(m.endDate),
    });
  }
  const current = members.filter((m) => isCurrentMembership(m.endDate));
  const past = members.filter((m) => !isCurrentMembership(m.endDate)).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));

  // How much of each candidate's time is already committed across all projects.
  const onTeam = new Set(current.map((m) => m.employee.id));
  const candidates = options.filter((o) => o.status !== "exited" && !onTeam.has(o.value));
  const load = candidates.length
    ? await ProjectMember.aggregate<{ _id: Types.ObjectId; total: number }>([
        { $match: { ...currentMembership(), employee: { $in: candidates.map((c) => new Types.ObjectId(c.value)) } } },
        { $group: { _id: "$employee", total: { $sum: "$allocation" } } },
      ])
    : [];
  const allocated = new Map(load.map((l) => [String(l._id), l.total]));

  return {
    current,
    past,
    totalAllocation: current.reduce((sum, m) => sum + m.allocation, 0),
    options: candidates.map((o) => ({
      value: o.value,
      label: o.label,
      description: o.description,
      department: (o.department || "engineering") as Department,
      allocated: allocated.get(o.value) ?? 0,
    })),
  };
}

/** Number of people currently on a project's team. */
export async function countProjectMembers(projectId: string): Promise<number> {
  if (!Types.ObjectId.isValid(projectId)) return 0;
  await connectDB();
  return ProjectMember.countDocuments({ project: projectId, ...currentMembership() });
}

/** Active (not exited) headcount, handy for pickers and empty states. */
export async function countActiveEmployees(): Promise<number> {
  await connectDB();
  return Employee.countDocuments({ status: { $ne: "exited" } });
}
