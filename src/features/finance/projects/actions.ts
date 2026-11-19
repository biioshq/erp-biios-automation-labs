"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { Expense, FileModel, Income, InventoryAllocation, InventoryMovement, Project, Task } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { removeFile } from "@/features/files/server";
import { fromDateInput } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { PROJECT_STAGES } from "@/lib/constants";
import {
  documentRefSchema,
  documentTypeSchema,
  projectFormSchema,
  projectIdSchema,
  projectStatusSchema,
  type ProjectFormValues,
} from "./schemas";

const REVALIDATE: [string, "layout"][] = [["/finance", "layout"]];

function toDocument(v: ProjectFormValues) {
  const stageBudgets = Object.fromEntries(
    PROJECT_STAGES.map((s) => [s.value, round2(v.stageBudgets?.[s.value] ?? 0)]),
  );
  return {
    name: v.name,
    client: v.client,
    description: v.description,
    status: v.status,
    budget: round2(v.budget),
    stageBudgets,
    startDate: v.startDate ? fromDateInput(v.startDate) : undefined,
    endDate: v.endDate ? fromDateInput(v.endDate) : undefined,
    color: v.color,
  };
}

export const createProject = defineAction(
  projectFormSchema,
  async (input, user) => {
    const code = await nextNumber("project");
    const created = await Project.create({ ...toDocument(input), code, createdBy: new Types.ObjectId(user.id) });
    return { id: String(created._id), code };
  },
  { revalidate: REVALIDATE, message: "Project created" },
);

export const updateProject = defineAction(
  projectFormSchema.and(projectIdSchema),
  async (input) => {
    const doc = toDocument(input);
    const unset = {
      ...(doc.client ? {} : { client: 1 }),
      ...(doc.description ? {} : { description: 1 }),
      ...(doc.startDate ? {} : { startDate: 1 }),
      ...(doc.endDate ? {} : { endDate: 1 }),
    };
    // Cleared fields are unset, never written as undefined.
    const set = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
    const result = await Project.updateOne({ _id: input.id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    if (!result.matchedCount) throw notFound("The project");
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Project updated" },
);

export const setProjectStatus = defineAction(
  projectStatusSchema,
  async ({ id, status }) => {
    const result = await Project.updateOne({ _id: id }, { $set: { status } });
    if (!result.matchedCount) throw notFound("The project");
    return { id, status };
  },
  { revalidate: REVALIDATE, message: "Status updated" },
);

/** Deletes a project that nothing refers to. Its uploaded documents go with it. */
export const deleteProject = defineAction(
  projectIdSchema,
  async ({ id }) => {
    const project = await Project.findById(id).lean();
    if (!project) throw notFound("The project");
    const oid = project._id;
    const [expenses, income, allocations, tasks, movements] = await Promise.all([
      Expense.countDocuments({ project: oid }),
      Income.countDocuments({ project: oid }),
      InventoryAllocation.countDocuments({ project: oid }),
      Task.countDocuments({ project: oid }),
      InventoryMovement.countDocuments({ project: oid }),
    ]);
    const linked = [
      expenses && `${expenses} expense${expenses === 1 ? "" : "s"}`,
      income && `${income} income record${income === 1 ? "" : "s"}`,
      (allocations || movements) && "inventory assignments",
      tasks && `${tasks} task${tasks === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (linked.length) {
      throw new AppError(`${project.name} has ${linked.join(", ")}. Mark it Completed or Cancelled instead of deleting it.`, "conflict");
    }
    const files = await FileModel.find({ project: oid }, { _id: 1 }).lean();
    for (const f of files) await removeFile(String(f._id));
    await Project.deleteOne({ _id: oid });
    return { id };
  },
  { revalidate: REVALIDATE, message: "Project deleted", role: "admin" },
);

async function projectDocument(projectId: string, fileId: string) {
  const file = await FileModel.findOne({ _id: fileId, project: projectId, kind: "document" }).lean();
  if (!file) throw notFound("The document");
  return file;
}

export const removeProjectDocument = defineAction(
  documentRefSchema,
  async ({ projectId, fileId }) => {
    await projectDocument(projectId, fileId);
    await removeFile(fileId);
    return { fileId };
  },
  { revalidate: REVALIDATE, message: "Document deleted" },
);

export const setProjectDocumentType = defineAction(
  documentTypeSchema,
  async ({ projectId, fileId, documentType }) => {
    await projectDocument(projectId, fileId);
    await FileModel.updateOne({ _id: fileId }, { $set: { documentType } });
    return { fileId, documentType };
  },
  { revalidate: REVALIDATE, message: "Document type changed" },
);
