"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { FileModel, Task } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { createNotification } from "@/server/services/notifications";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { attachFiles, removeFile } from "@/features/files/server";
import { fromDateInput } from "@/lib/dates";
import type { TaskStatus } from "@/lib/constants";
import {
  taskAttachSchema,
  taskCommentSchema,
  taskDetachSchema,
  taskFormSchema,
  taskIdSchema,
  taskMoveSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from "./schemas";
import { getTask } from "./queries";
import type { TaskComment, TaskDetail } from "./types";

const REVALIDATE: [string, "layout"][] = [
  ["/tasks", "layout"],
  ["/finance/projects", "layout"],
  ["/settings", "layout"],
];

const oid = (id: string) => new Types.ObjectId(id);

/** Next position at the bottom of a Kanban column. */
async function endOfColumn(status: TaskStatus): Promise<number> {
  const last = await Task.findOne({ status }).sort({ order: -1 }).select("order").lean();
  return (last?.order ?? 0) + 1;
}

/** Completing sets completedAt; leaving Completed clears it. */
function completionPatch(from: string | undefined, to: TaskStatus): { set: Record<string, unknown>; unset: Record<string, 1> } {
  if (to === "completed" && from !== "completed") return { set: { completedAt: new Date() }, unset: {} };
  if (to !== "completed" && from === "completed") return { set: {}, unset: { completedAt: 1 } };
  return { set: {}, unset: {} };
}

/** Files that are free to attach: uploaded but not yet owned by another record, or already on this task. */
async function claimableFiles(fileIds: string[], taskId: string): Promise<string[]> {
  if (!fileIds.length) return [];
  const docs = await FileModel.find(
    { _id: { $in: fileIds.map(oid) }, $or: [{ "entity.id": { $exists: false } }, { "entity.id": null }, { "entity.id": oid(taskId) }] },
    { _id: 1 },
  ).lean();
  const ok = new Set(docs.map((d) => String(d._id)));
  return fileIds.filter((id) => ok.has(id));
}

async function notifyAssigned(task: { id: string; number: string; title: string }, assigneeId: string | undefined, actor: SessionUser) {
  if (!assigneeId || assigneeId === actor.id) return;
  try {
    await createNotification({
      type: "task_assigned",
      user: assigneeId,
      title: `${actor.name} assigned you ${task.number}`,
      body: task.title,
      href: `/tasks/all?task=${task.id}`,
      entity: { type: "task", id: task.id },
    });
  } catch (error) {
    console.error("[tasks] could not create the assignment notification", error);
  }
}

export const createTask = defineAction(
  taskFormSchema,
  async (input, user) => {
    const _id = new Types.ObjectId();
    const id = String(_id);
    const [number, order, attachmentIds] = await Promise.all([
      nextNumber("task"),
      endOfColumn(input.status),
      claimableFiles(input.attachmentIds, id),
    ]);
    await Task.create({
      _id,
      number,
      title: input.title,
      description: input.description,
      project: input.projectId ? oid(input.projectId) : undefined,
      assignee: input.assigneeId ? oid(input.assigneeId) : undefined,
      priority: input.priority,
      dueDate: input.dueDate ? fromDateInput(input.dueDate) : undefined,
      status: input.status,
      order,
      attachments: attachmentIds.map(oid),
      completedAt: input.status === "completed" ? new Date() : undefined,
      createdBy: oid(user.id),
    });
    await attachFiles(attachmentIds, { type: "task", id }, input.projectId);
    await notifyAssigned({ id, number, title: input.title }, input.assigneeId, user);
    return { id, number };
  },
  { revalidate: REVALIDATE, message: "Task created" },
);

export const updateTask = defineAction(
  taskUpdateSchema,
  async (input, user) => {
    const existing = await Task.findById(input.id).lean();
    if (!existing) throw notFound("The task");

    const statusChanged = existing.status !== input.status;
    const completion = completionPatch(existing.status, input.status);
    const currentFiles = (existing.attachments ?? []).map(String);
    const wanted = input.attachmentIds;
    const added = await claimableFiles(
      wanted.filter((f) => !currentFiles.includes(f)),
      input.id,
    );
    const kept = wanted.filter((f) => currentFiles.includes(f) || added.includes(f));
    const removed = currentFiles.filter((f) => !kept.includes(f));

    const set: Record<string, unknown> = {
      title: input.title,
      priority: input.priority,
      status: input.status,
      attachments: kept.map(oid),
      ...completion.set,
    };
    const unset: Record<string, 1> = { ...completion.unset };
    const optional: [string, unknown][] = [
      ["description", input.description],
      ["project", input.projectId ? oid(input.projectId) : undefined],
      ["assignee", input.assigneeId ? oid(input.assigneeId) : undefined],
      ["dueDate", input.dueDate ? fromDateInput(input.dueDate) : undefined],
    ];
    for (const [key, value] of optional) {
      if (value === undefined) unset[key] = 1;
      else set[key] = value;
    }
    if (statusChanged) set.order = await endOfColumn(input.status);

    await Task.updateOne({ _id: existing._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    await Promise.all(removed.map(removeFile));
    await attachFiles(added, { type: "task", id: input.id }, input.projectId);
    if (String(existing.assignee ?? "") !== (input.assigneeId ?? "")) {
      await notifyAssigned({ id: input.id, number: existing.number, title: input.title }, input.assigneeId, user);
    }
    return { id: input.id };
  },
  { revalidate: REVALIDATE, message: "Task updated" },
);

export const setTaskStatus = defineAction(
  taskStatusSchema,
  async ({ id, status }) => {
    const existing = await Task.findById(id).lean();
    if (!existing) throw notFound("The task");
    if (existing.status === status) return { id };
    const completion = completionPatch(existing.status, status);
    await Task.updateOne(
      { _id: existing._id },
      { $set: { status, order: await endOfColumn(status), ...completion.set }, ...(Object.keys(completion.unset).length ? { $unset: completion.unset } : {}) },
    );
    return { id };
  },
  { revalidate: REVALIDATE, message: "Status updated" },
);

export const moveTask = defineAction(
  taskMoveSchema,
  async ({ id, status, order, renumber }) => {
    const existing = await Task.findById(id).lean();
    if (!existing) throw notFound("The task");
    const completion = completionPatch(existing.status, status);
    await Task.updateOne(
      { _id: existing._id },
      { $set: { status, order, ...completion.set }, ...(Object.keys(completion.unset).length ? { $unset: completion.unset } : {}) },
    );
    if (renumber?.length) {
      await Task.bulkWrite(
        renumber.filter((r) => r.id !== id).map((r) => ({ updateOne: { filter: { _id: oid(r.id) }, update: { $set: { order: r.order } } } })),
      );
    }
    return { id };
  },
  { revalidate: REVALIDATE },
);

export const deleteTask = defineAction(
  taskIdSchema,
  async ({ id }) => {
    const existing = await Task.findById(id).lean();
    if (!existing) throw notFound("The task");
    await Task.deleteOne({ _id: existing._id });
    await Promise.all((existing.attachments ?? []).map((f) => removeFile(String(f))));
    return { id };
  },
  { revalidate: REVALIDATE, message: "Task deleted" },
);

export const addTaskComment = defineAction(
  taskCommentSchema,
  async ({ id, body }, user): Promise<TaskComment> => {
    const updated = await Task.findByIdAndUpdate(id, { $push: { comments: { author: oid(user.id), body } } }, { new: true }).lean();
    if (!updated) throw notFound("The task");
    const comment = updated.comments[updated.comments.length - 1]!;
    if (updated.assignee && String(updated.assignee) !== user.id) {
      try {
        await createNotification({
          type: "task_comment",
          user: String(updated.assignee),
          title: `${user.name} commented on ${updated.number}`,
          body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
          href: `/tasks/all?task=${id}`,
          entity: { type: "task", id },
        });
      } catch (error) {
        console.error("[tasks] could not create the comment notification", error);
      }
    }
    return {
      id: String(comment._id),
      body: comment.body,
      createdAt: (comment.createdAt as Date).toISOString(),
      author: { id: user.id, name: user.name, image: user.image },
    };
  },
  { revalidate: [["/tasks", "layout"]] },
);

export const attachToTask = defineAction(
  taskAttachSchema,
  async ({ id, fileIds }) => {
    const task = await Task.findById(id).lean();
    if (!task) throw notFound("The task");
    const ok = await claimableFiles(fileIds, id);
    if (!ok.length) throw new AppError("Those files could not be attached.", "invalid");
    await Task.updateOne({ _id: task._id }, { $addToSet: { attachments: { $each: ok.map(oid) } } });
    await attachFiles(ok, { type: "task", id }, task.project ? String(task.project) : undefined);
    return { id };
  },
  { revalidate: REVALIDATE, message: "Attachment added" },
);

export const removeTaskAttachment = defineAction(
  taskDetachSchema,
  async ({ id, fileId }) => {
    const task = await Task.findById(id).lean();
    if (!task) throw notFound("The task");
    if (!(task.attachments ?? []).some((a) => String(a) === fileId)) throw notFound("The attachment");
    await Task.updateOne({ _id: task._id }, { $pull: { attachments: oid(fileId) } });
    await removeFile(fileId);
    return { id };
  },
  { revalidate: REVALIDATE, message: "Attachment removed" },
);

/** Loads one task for the detail drawer / edit form. */
export async function fetchTask(id: string): Promise<TaskDetail | null> {
  if (!(await getCurrentUser())) return null;
  return getTask(id);
}

/** Removes uploads from a form that was cancelled before saving. Only the uploader's unattached files. */
export async function discardUnsavedAttachments(fileIds: string[]) {
  const user = await getCurrentUser();
  if (!user) return;
  const ids = fileIds.filter((id) => Types.ObjectId.isValid(id));
  if (!ids.length) return;
  const docs = await FileModel.find({
    _id: { $in: ids.map(oid) },
    uploadedBy: oid(user.id),
    $or: [{ "entity.id": { $exists: false } }, { "entity.id": null }],
  })
    .select("_id")
    .lean();
  await Promise.all(docs.map((d) => removeFile(String(d._id))));
}
