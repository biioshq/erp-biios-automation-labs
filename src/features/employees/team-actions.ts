"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Employee, Project, ProjectMember } from "@/server/models";
import { fromDateInput, startOfDayIST } from "@/lib/dates";
import { addMemberSchema, endMemberSchema, updateMemberSchema } from "./schemas";
import { currentMembership } from "./membership";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

export const addProjectMember = defineAction(
  addMemberSchema,
  async (input, user) => {
    const [project, employee, open] = await Promise.all([
      Project.exists({ _id: input.projectId }),
      Employee.findById(input.employeeId, { name: 1, status: 1 }).lean(),
      // A membership ending later (someone on notice) still counts: they are on the team until then.
      ProjectMember.exists({ project: input.projectId, employee: input.employeeId, ...currentMembership() }),
    ]);
    if (!project) throw notFound("The project");
    if (!employee) throw notFound("The employee");
    if (employee.status === "exited") {
      throw new AppError(`${employee.name} has left the company.`, "conflict", { employeeId: ["Has left the company"] });
    }
    if (open) throw new AppError(`${employee.name} is already on this project.`, "conflict", { employeeId: ["Already on this project"] });
    const created = await ProjectMember.create({
      project: new Types.ObjectId(input.projectId),
      employee: new Types.ObjectId(input.employeeId),
      role: input.role,
      allocation: input.allocation,
      startDate: fromDateInput(input.startDate),
      endDate: null,
      createdBy: new Types.ObjectId(user.id),
    });
    return { id: String(created._id) };
  },
  { revalidate: REVALIDATE, message: "Added to the project team" },
);

export const updateProjectMember = defineAction(
  updateMemberSchema,
  async (input) => {
    const updated = await ProjectMember.updateOne({ _id: input.id, ...currentMembership() }, { $set: { role: input.role, allocation: input.allocation } });
    if (!updated.matchedCount) throw notFound("That team membership");
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Membership updated" },
);

export const endProjectMember = defineAction(
  endMemberSchema,
  async (input) => {
    const m = await ProjectMember.findOne({ _id: input.id, ...currentMembership() }, { startDate: 1 }).lean();
    if (!m) throw notFound("That team membership");
    let end = input.endDate ? fromDateInput(input.endDate) : startOfDayIST();
    if (m.startDate && end < m.startDate) end = m.startDate;
    await ProjectMember.updateOne({ _id: m._id }, { $set: { endDate: end } });
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Membership ended" },
);
