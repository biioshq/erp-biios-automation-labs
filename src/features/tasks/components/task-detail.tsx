"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { CalendarDays, CircleDot, Flag, FolderKanban, Paperclip, Pencil, Send, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { PriorityBadge, TaskStatusBadge } from "@/components/shared/status-badge";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS } from "@/features/files/types";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import { addTaskComment, attachToTask, removeTaskAttachment, setTaskStatus } from "../actions";
import type { TaskComment, TaskDetail, TaskPerson } from "../types";
import { DueDate, PersonAvatar, PersonName, dueLabel } from "./task-bits";

function Row({ icon: Icon, label, children }: { icon: typeof User; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-24 shrink-0 text-sm text-muted-foreground sm:w-28">{label}</span>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

export function TaskDetailSkeleton() {
  return (
    <FormSheetBody className="space-y-4 max-md:min-h-[72dvh]">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </FormSheetBody>
  );
}

/** Read view of a task: properties, description, attachments, comments and activity. */
export function TaskDetailView({
  task,
  currentUser,
  onChanged,
  onEdit,
  onDelete,
}: {
  task: TaskDetail;
  currentUser: TaskPerson;
  /** Reloads the task (and refreshes lists) after a change made inside the drawer. */
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(task.status);
  const [comments, addOptimisticComment] = useOptimistic(task.comments, (state, comment: TaskComment) => [...state, comment]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);

  function changeStatus(status: TaskStatus) {
    startTransition(async () => {
      setOptimisticStatus(status);
      const result = await setTaskStatus({ id: task.id, status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      emitDataChanged();
      await onChanged();
    });
  }

  function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    startTransition(async () => {
      addOptimisticComment({
        id: `pending-${Date.now()}`,
        body,
        createdAt: new Date().toISOString(),
        author: currentUser,
      });
      const result = await addTaskComment({ id: task.id, body });
      if (!result.ok) {
        toast.error(result.error);
        setDraft(body);
      } else {
        emitDataChanged();
        await onChanged();
      }
      setSending(false);
      composer.current?.focus();
    });
  }

  async function removeAttachment(fileId: string, name: string) {
    const result = await removeTaskAttachment({ id: task.id, fileId });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${name} removed`);
    await onChanged();
  }

  async function attached(fileId: string) {
    const result = await attachToTask({ id: task.id, fileIds: [fileId] });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await onChanged();
  }

  const overdue = task.overdue && optimisticStatus === task.status;

  return (
    <>
      <FormSheetBody className="flex flex-col space-y-6 pb-0 max-md:min-h-[72dvh] sm:pb-0">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{task.number}</span>
            <TaskStatusBadge status={optimisticStatus} overdue={overdue} />
            <PriorityBadge priority={task.priority} />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-balance break-words">{task.title}</h2>
        </div>

        <div className="divide-y rounded-xl border px-4">
          <Row icon={CircleDot} label="Status">
            <Select value={optimisticStatus} onValueChange={(v) => changeStatus(v as TaskStatus)}>
              <SelectTrigger size="sm" className="w-full max-w-52 max-md:h-10" aria-label="Change status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row icon={Flag} label="Priority">
            <PriorityBadge priority={task.priority} />
          </Row>
          <Row icon={User} label="Assigned to">
            <PersonName person={task.assignee} />
          </Row>
          <Row icon={CalendarDays} label="Due date">
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <DueDate task={{ ...task, status: optimisticStatus }} className="text-sm" />
              {task.dueDate && optimisticStatus !== "completed" && optimisticStatus !== "cancelled" ? (
                <span className={task.overdue ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{dueLabel(task.dueDate)}</span>
              ) : null}
            </span>
          </Row>
          <Row icon={FolderKanban} label="Project">
            {task.project ? (
              <Link href={`/finance/projects/${task.project.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                <span className="size-2 rounded-full" style={{ background: task.project.color }} />
                {task.project.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">No project</span>
            )}
          </Row>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Description</h3>
          {task.description ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{task.description}</p>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">No description yet. Edit the task to add one.</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Paperclip className="size-4 text-muted-foreground" /> Attachments
            <span className="tabular text-xs font-normal text-muted-foreground">{task.attachments.length}</span>
          </h3>
          {task.attachments.length ? (
            <div className="space-y-2">
              {task.attachments.map((f) => (
                <FileTile key={f.id} file={f} onRemove={() => void removeAttachment(f.id, f.name)} />
              ))}
            </div>
          ) : null}
          <FileDropzone
            compact
            accept={ACCEPT_DOCUMENTS}
            meta={{ kind: "attachment", entityType: "task", entityId: task.id, projectId: task.project?.id }}
            onUploaded={(f) => void attached(f.id)}
            title="Add attachments"
            hint="Drop files or click to upload"
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">
            Comments <span className="tabular text-xs font-normal text-muted-foreground">{comments.length}</span>
          </h3>
          {comments.length ? (
            <ul className="space-y-4">
              {comments.map((c) => (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex gap-3"
                >
                  <PersonAvatar person={c.author} size="default" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{c.author?.name ?? "Former member"}</span>
                      <span suppressHydrationWarning className="text-xs text-muted-foreground" title={formatDateTime(c.createdAt)}>
                        {formatRelative(c.createdAt)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-foreground/90">{c.body}</p>
                  </div>
                </motion.li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No comments yet. Start the conversation below.</p>
          )}
        </section>

        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(task.createdAt)}
          {task.createdBy ? ` by ${task.createdBy.name}` : ""}
          {task.completedAt ? ` · completed ${formatDateTime(task.completedAt)}` : ""}
        </p>
        <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
          <div className="space-y-2 rounded-xl border bg-surface/40 p-2.5">
            <Textarea
              ref={composer}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Write a comment…"
              aria-label="Write a comment"
              className="min-h-14 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                <Kbd>Ctrl</Kbd>
                <Kbd>Enter</Kbd> to send
              </span>
              <Button type="button" size="sm" className="ml-auto max-md:px-4" onClick={send} disabled={!draft.trim() || sending}>
                {sending ? <Spinner /> : <Send />} Comment
              </Button>
            </div>
          </div>
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <ConfirmDialog
          title="Delete this task?"
          description={`${task.number} "${task.title}", its comments and attachments will be removed.`}
          onConfirm={onDelete}
          trigger={
            <Button variant="ghost" className="mr-auto text-danger hover:bg-danger/10 hover:text-danger max-md:px-3">
              <Trash2 /> Delete
            </Button>
          }
        />
        <Button onClick={onEdit} className="max-md:flex-1">
          <Pencil /> Edit
        </Button>
      </FormSheetFooter>
    </>
  );
}
