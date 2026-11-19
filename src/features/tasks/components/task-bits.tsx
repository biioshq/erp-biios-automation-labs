"use client";

import { MessageSquare, Paperclip } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { toDateInput } from "@/lib/dates";
import { formatDate, formatDateShort, initials } from "@/lib/format";
import type { TaskPerson, TaskRow } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today (IST) to a due date: negative when past. */
export function daysUntil(due: string, today: string = toDateInput(new Date())): number {
  return Math.round((Date.parse(`${toDateInput(due)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function dueLabel(due: string | null, today?: string): string {
  if (!due) return "No due date";
  const d = daysUntil(due, today);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d > 1 && d < 31) return `In ${d} days`;
  if (d < -1 && d > -31) return `${-d} days ago`;
  return formatDate(due);
}

export function PersonAvatar({ person, size = "sm", className }: { person: TaskPerson | null; size?: "sm" | "default"; className?: string }) {
  return (
    <Avatar size={size} className={className}>
      {person?.image ? <AvatarImage src={person.image} alt="" /> : null}
      <AvatarFallback className={cn("font-semibold", person ? "bg-brand/15 text-brand-ink" : "bg-muted text-muted-foreground")}>
        {person ? initials(person.name) : "?"}
      </AvatarFallback>
    </Avatar>
  );
}

export function PersonName({ person, className }: { person: TaskPerson | null; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <PersonAvatar person={person} />
      <span className={cn("truncate text-sm", !person && "text-muted-foreground")}>{person?.name ?? "Unassigned"}</span>
    </span>
  );
}

export function ProjectChip({ project, className }: { project: TaskRow["project"]; className?: string }) {
  if (!project) return null;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: project.color }} aria-hidden />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

/** Due date in short form, red when overdue. */
export function DueDate({ task, relative, className }: { task: Pick<TaskRow, "dueDate" | "overdue" | "status">; relative?: boolean; className?: string }) {
  if (!task.dueDate) return <span className={cn("text-xs text-muted-foreground/70", className)}>No due date</span>;
  const done = task.status === "completed" || task.status === "cancelled";
  return (
    <span className={cn("tabular whitespace-nowrap text-xs", task.overdue ? "font-medium text-danger" : "text-muted-foreground", className)}>
      {formatDateShort(task.dueDate)}
      {relative && !done ? <span className="ml-1.5 opacity-80">{dueLabel(task.dueDate)}</span> : null}
    </span>
  );
}

export function TaskCounts({ task, className }: { task: Pick<TaskRow, "commentCount" | "attachmentCount">; className?: string }) {
  if (!task.commentCount && !task.attachmentCount) return null;
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-xs text-muted-foreground", className)}>
      {task.commentCount ? (
        <span className="tabular inline-flex items-center gap-1" title={`${task.commentCount} comments`}>
          <MessageSquare className="size-3.5" aria-hidden /> {task.commentCount}
        </span>
      ) : null}
      {task.attachmentCount ? (
        <span className="tabular inline-flex items-center gap-1" title={`${task.attachmentCount} attachments`}>
          <Paperclip className="size-3.5" aria-hidden /> {task.attachmentCount}
        </span>
      ) : null}
    </span>
  );
}

/** Priority marker colours as theme tokens (a left rule on cards and pills). */
export const PRIORITY_RULE: Record<TaskRow["priority"], string> = {
  low: "bg-muted-foreground/40",
  medium: "bg-info",
  high: "bg-warning",
  urgent: "bg-danger",
};
