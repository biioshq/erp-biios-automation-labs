import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES, valuesOf } from "@/lib/constants";
import { objectId, optionalDateInput, optionalObjectId, optionalText, requiredText } from "@/lib/zod";

/** Validation shared by the task form (client) and the task actions (server). Client-safe. */

export const taskFormSchema = z.object({
  title: requiredText("Title", 200),
  description: optionalText(10000),
  projectId: optionalObjectId,
  assigneeId: optionalObjectId,
  priority: z.enum(valuesOf(TASK_PRIORITIES), { error: "Pick a priority" }),
  dueDate: optionalDateInput,
  status: z.enum(valuesOf(TASK_STATUSES), { error: "Pick a status" }),
  attachmentIds: z.array(objectId).max(20, "At most 20 attachments").default([]),
});

export type TaskFormInput = z.input<typeof taskFormSchema>;
export type TaskFormValues = z.output<typeof taskFormSchema>;

export const taskIdSchema = z.object({ id: objectId });
export const taskUpdateSchema = taskFormSchema.extend({
  id: objectId,
  /**
   * Saved attachments the editor removed in the form. Only these are deleted, so a file someone else
   * attached while the form was open survives the save.
   */
  removedAttachmentIds: z.array(objectId).max(20).default([]),
});

export const taskStatusSchema = z.object({ id: objectId, status: z.enum(valuesOf(TASK_STATUSES)) });

/** Kanban move: new column plus a position (fractional order between its neighbours). */
export const taskMoveSchema = z.object({
  id: objectId,
  status: z.enum(valuesOf(TASK_STATUSES)),
  /** Left out to put the card at the bottom of the whole column, including cards the board does not show. */
  order: z.number().finite().optional(),
  /** New positions for the column's other cards, sent only when neighbours had equal positions. */
  renumber: z.array(z.object({ id: objectId, order: z.number().finite() })).max(250).optional(),
});

export const taskCommentSchema = z.object({
  id: objectId,
  body: z.string().trim().min(1, "Write a comment first").max(4000, "At most 4000 characters"),
});

export const taskAttachSchema = z.object({ id: objectId, fileIds: z.array(objectId).min(1).max(20) });
export const taskDetachSchema = z.object({ id: objectId, fileId: objectId });

/** Filter keys accepted in the URL of the task lists. */
export const TASK_FILTER_KEYS = ["status", "priority", "project", "assignee", "completed"] as const;
/** Values of the "completed" filter: when a task was completed, by IST calendar month. */
export const TASK_COMPLETED_RANGES = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
] as const;
export const TASK_SORT_KEYS = ["dueDate", "priority", "status", "title", "updatedAt", "createdAt"] as const;
export const TASK_VIEWS = ["table", "board", "calendar"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

/** Status pages: real statuses plus the derived "overdue". */
export const TASK_PAGE_STATUSES = ["pending", "in_progress", "review", "completed", "cancelled", "overdue"] as const;
export type TaskPageStatus = (typeof TASK_PAGE_STATUSES)[number];

export const BOARD_LIMIT = 200;
