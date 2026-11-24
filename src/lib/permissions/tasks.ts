import type { PermissionResource } from "./types";

/**
 * Tasks. Member defaults match what a member could do before roles existed: see every task,
 * create tasks, edit them, change their status, move them on the board, comment and attach files.
 * Only admins could delete a task or remove an attachment.
 */
export const TASKS_RESOURCES: PermissionResource[] = [
  {
    key: "tasks.tasks",
    module: "tasks",
    group: "Tasks",
    label: "Tasks",
    description: "Every task page, board and calendar. Edit covers changes, status, board moves, comments and new attachments. Delete covers deleting a task and removing an attachment.",
    actions: ["view", "create", "edit", "delete"],
    memberDefault: ["view", "create", "edit"],
  },
];
