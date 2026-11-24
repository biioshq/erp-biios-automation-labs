"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { runAtomic } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import type { SessionUser } from "@/server/auth/session";
import { Expense, FileModel, Income, InventoryAllocation, InventoryMovement, Project, ProjectMember, RecurringExpense, Task } from "@/server/models";
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
    contractValue: v.contractValue === undefined ? undefined : round2(v.contractValue),
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

/**
 * The update for an edited project. When the budget changes, the budget it had is pushed onto
 * budgetHistory first (older entries are never rewritten), so the original budget stays known.
 */
function projectUpdate(doc: ReturnType<typeof toDocument>, previousBudget: number, note: string | undefined, user: SessionUser) {
  const unset = {
    ...(doc.client ? {} : { client: 1 }),
    ...(doc.description ? {} : { description: 1 }),
    ...(doc.startDate ? {} : { startDate: 1 }),
    ...(doc.endDate ? {} : { endDate: 1 }),
    ...(doc.contractValue === undefined ? { contractValue: 1 } : {}),
  };
  // Cleared fields are unset, never written as undefined.
  const set = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  const changed = round2(previousBudget) !== doc.budget;
  const entry = { budget: previousBudget, changedAt: new Date(), changedBy: new Types.ObjectId(user.id), ...(note ? { note } : {}) };
  return {
    $set: set,
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
    ...(changed ? { $push: { budgetHistory: entry } } : {}),
  };
}

export const updateProject = defineAction(
  projectFormSchema.and(projectIdSchema),
  async (input, user) => {
    const current = await Project.findById(input.id, { budget: 1 }).lean();
    if (!current) throw notFound("The project");
    const doc = toDocument(input);
    // Matched on the budget the form was opened with (or, without one, the budget read above). If
    // someone else changed it since, saving would quietly put the old figure back and push theirs
    // into the history, so this save stops and asks to reload instead.
    const expected = input.expectedBudget ?? current.budget;
    const result = await Project.updateOne({ _id: input.id, budget: expected }, projectUpdate(doc, expected, input.budgetNote, user));
    if (!result.matchedCount) {
      const exists = await Project.exists({ _id: input.id });
      if (!exists) throw notFound("The project");
      throw new AppError("Someone changed this project's budget while you were editing. Close the form, open it again and save once more.", "conflict");
    }
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

/** Deletes a project that nothing refers to. Its uploaded documents and its team list go with it. */
export const deleteProject = defineAction(
  projectIdSchema,
  async ({ id }) => {
    const project = await Project.findById(id).lean();
    if (!project) throw notFound("The project");
    const oid = project._id;
    const [expenses, income, allocations, tasks, movements, schedules] = await Promise.all([
      Expense.countDocuments({ project: oid }),
      Income.countDocuments({ project: oid }),
      InventoryAllocation.countDocuments({ project: oid }),
      Task.countDocuments({ project: oid }),
      InventoryMovement.countDocuments({ project: oid }),
      // A live schedule would keep posting expenses to the deleted project.
      RecurringExpense.countDocuments({ project: oid, status: { $ne: "ended" } }),
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
    if (schedules) {
      throw new AppError(
        `${project.name} has ${schedules} active or paused recurring schedule${schedules === 1 ? "" : "s"}. End them or move them to another project first.`,
        "conflict",
      );
    }
    // Team rows go with the project: left behind, they would keep counting as allocated time
    // and stop the employee from ever being deleted.
    await runAtomic(async ({ session, onRollback }) => {
      const members = await ProjectMember.find({ project: oid }, null, { session }).lean();
      await ProjectMember.deleteMany({ project: oid }, { session });
      onRollback(() => (members.length ? ProjectMember.insertMany(members) : Promise.resolve()));
      await Project.deleteOne({ _id: oid }, { session });
    });
    // Files are cleaned up only once the project is gone: deleted bytes cannot be rolled back, so
    // doing this first would leave a surviving project without its documents if the delete failed.
    // Only project documents belong to the project itself. Receipts and task attachments that
    // still carry its tag belong to records that moved elsewhere: keep them, drop the stale tag.
    await FileModel.updateMany({ project: oid, kind: { $ne: "document" } }, { $unset: { project: 1 } });
    const files = await FileModel.find({ project: oid, kind: "document" }, { _id: 1 }).lean();
    for (const f of files) await removeFile(String(f._id));
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
  { revalidate: REVALIDATE, message: "Document deleted", role: "admin" },
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
