import type { FileDTO } from "@/features/files/types";
import type { TaskPriority, TaskStatus } from "@/lib/constants";

export type TaskPerson = { id: string; name: string; image: string | null };

/** A task as the table, board, calendar and dashboard lists show it. */
export type TaskRow = {
  id: string;
  number: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** ISO instant of IST midnight on the due day. */
  dueDate: string | null;
  /** Derived: due before today (IST) and not completed or cancelled. */
  overdue: boolean;
  order: number;
  project: { id: string; name: string; code: string; color: string } | null;
  assignee: TaskPerson | null;
  commentCount: number;
  attachmentCount: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskComment = { id: string; body: string; createdAt: string; author: TaskPerson | null };

/** Everything the detail drawer and the edit form need. */
export type TaskDetail = TaskRow & {
  description: string | null;
  attachments: FileDTO[];
  comments: TaskComment[];
  createdBy: { id: string; name: string } | null;
};

export type TaskCounts = Record<TaskStatus, number>;

export type DashboardData = {
  open: number;
  dueSoon: number;
  overdue: number;
  completedThisMonth: number;
  myOpen: number;
  byStatus: { status: TaskStatus; count: number }[];
  byPriority: { priority: TaskPriority; count: number }[];
  completedPerWeek: { label: string; count: number }[];
  overdueTasks: TaskRow[];
  dueSoonTasks: TaskRow[];
  recentlyCompleted: TaskRow[];
  workload: { person: TaskPerson | null; open: number; overdue: number }[];
};
