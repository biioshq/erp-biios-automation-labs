"use server";

import { Types } from "mongoose";
import { defineAction } from "@/server/action";
import { AppError, notFound } from "@/server/errors";
import { FileModel, Task } from "@/server/models";
import { nextNumber } from "@/server/services/numbering";
import { createNotification } from "@/server/services/notifications";
import { can, getCurrentUser, type SessionUser } from "@/server/auth/session";
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

/**
 * Files that are free to attach: the user's own attachment uploads not yet owned by a record, or files already
 * on this task. Someone else's unsaved upload, such as a receipt waiting on an expense form, is never taken.
 */
async function claimableFiles(fileIds: string[], taskId: string, userId: string): Promise<string[]> {
  const valid = fileIds.filter((id) => Types.ObjectId.isValid(id));
  if (!valid.length) return [];
  const free = { kind: "attachment" as const, uploadedBy: oid(userId) };
  const docs = await FileModel.find(
    {
      _id: { $in: valid.map(oid) },
      $or: [{ "entity.id": { $exists: false }, ...free }, { "entity.id": null, ...free }, { "entity.id": oid(taskId) }],
    },
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
      claimableFiles(input.attachmentIds, id, user.id),
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
  { permission: "tasks.tasks:create", revalidate: REVALIDATE, message: "Task created" },
);

export const updateTask = defineAction(
  taskUpdateSchema,
  async (input, user) => {
    const existing = await Task.findById(input.id).lean();
    if (!existing) throw notFound("The task");

    const statusChanged = existing.status !== input.status;
    const completion = completionPatch(existing.status, input.status);
    const currentFiles = (existing.attachments ?? []).map(String);
    // Only what the editor removed is deleted, never a file someone attached while the form was open.
    const removed = input.removedAttachmentIds.filter((f) => currentFiles.includes(f) && !input.attachmentIds.includes(f));
    if (removed.length && !can(user, "tasks.tasks:delete")) {
      throw new AppError("You do not have permission to remove attachments. Ask an admin on your team.", "forbidden");
    }
    const added = await claimableFiles(
      input.attachmentIds.filter((f) => !currentFiles.includes(f)),
      input.id,
      user.id,
    );

    const set: Record<string, unknown> = {
      title: input.title,
      priority: input.priority,
      status: input.status,
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

    // $addToSet and $pull on the same array cannot share one update, so removals go second.
    await Task.updateOne(
      { _id: existing._id },
      {
        $set: set,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        ...(added.length ? { $addToSet: { attachments: { $each: added.map(oid) } } } : {}),
      },
    );
    if (removed.length) await Task.updateOne({ _id: existing._id }, { $pull: { attachments: { $in: removed.map(oid) } } });
    await Promise.all(removed.map(removeFile));
    await attachFiles(added, { type: "task", id: input.id }, input.projectId);
    // Files follow the task to its new project. Left on the old one, deleting that project would delete them.
    if (String(existing.project ?? "") !== (input.projectId ?? "")) {
      await FileModel.updateMany(
        { "entity.type": "task", "entity.id": existing._id },
        input.projectId ? { $set: { project: oid(input.projectId) } } : { $unset: { project: 1 } },
      );
    }
    if (String(existing.assignee ?? "") !== (input.assigneeId ?? "")) {
      await notifyAssigned({ id: input.id, number: existing.number, title: input.title }, input.assigneeId, user);
    }
    return { id: input.id };
  },
  { permission: "tasks.tasks:edit", revalidate: REVALIDATE, message: "Task updated" },
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
  { permission: "tasks.tasks:edit", revalidate: REVALIDATE, message: "Status updated" },
);

export const moveTask = defineAction(
  taskMoveSchema,
  async ({ id, status, order: requested, renumber }) => {
    const existing = await Task.findById(id).lean();
    if (!existing) throw notFound("The task");
    const completion = completionPatch(existing.status, status);
    // No position means "bottom of the column": the board may not show every card, so the server picks it.
    const order = requested ?? (existing.status === status ? (existing.order ?? 0) : await endOfColumn(status));
    await Task.updateOne(
      { _id: existing._id },
      { $set: { status, order, ...completion.set }, ...(Object.keys(completion.unset).length ? { $unset: completion.unset } : {}) },
    );
    if (renumber?.length) {
      await Task.bulkWrite(
        renumber.filter((r) => r.id !== id).map((r) => ({ updateOne: { filter: { _id: oid(r.id) }, update: { $set: { order: r.order } } } })),
      );
    }
    return { id, order };
  },
  { permission: "tasks.tasks:edit", revalidate: REVALIDATE },
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
  { permission: "tasks.tasks:delete", revalidate: REVALIDATE, message: "Task deleted" },
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
  { permission: "tasks.tasks:edit", revalidate: [["/tasks", "layout"]] },
);

export const attachToTask = defineAction(
  taskAttachSchema,
  async ({ id, fileIds }, user) => {
    const task = await Task.findById(id).lean();
    if (!task) throw notFound("The task");
    const ok = await claimableFiles(fileIds, id, user.id);
    if (!ok.length) throw new AppError("Those files could not be attached.", "invalid");
    await Task.updateOne({ _id: task._id }, { $addToSet: { attachments: { $each: ok.map(oid) } } });
    await attachFiles(ok, { type: "task", id }, task.project ? String(task.project) : undefined);
    return { id };
  },
  { permission: "tasks.tasks:edit", revalidate: REVALIDATE, message: "Attachment added" },
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
  { permission: "tasks.tasks:delete", revalidate: REVALIDATE, message: "Attachment removed" },
);

/** Loads one task for the detail drawer / edit form. */
export async function fetchTask(id: string): Promise<TaskDetail | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "tasks.tasks:view")) return null;
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
