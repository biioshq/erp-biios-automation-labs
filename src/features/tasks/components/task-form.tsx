"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ComboboxField, DateField, SelectField, TextField, TextareaField, FormSection } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, type FileDTO } from "@/features/files/types";
import { applyFieldErrors } from "@/lib/action-result";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { initials } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { ProjectOption } from "@/server/lookups";
import type { TeamMember } from "@/server/services/users";
import { createTask, discardUnsavedAttachments, updateTask } from "../actions";
import { taskFormSchema, type TaskFormInput, type TaskFormValues } from "../schemas";
import type { TaskDetail } from "../types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { formValidation } from "@/components/forms/form-options";
import { useIsAdmin } from "@/components/current-user";

export type TaskDefaults = { projectId?: string; assigneeId?: string; status?: TaskStatus };

function defaultsFrom(task: TaskDetail | null | undefined, defaults: TaskDefaults): TaskFormInput {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    projectId: task ? (task.project?.id ?? undefined) : defaults.projectId,
    assigneeId: task ? (task.assignee?.id ?? undefined) : defaults.assigneeId,
    priority: task?.priority ?? "medium",
    dueDate: task?.dueDate ? toDateInput(task.dueDate) : undefined,
    status: task?.status ?? defaults.status ?? "pending",
    attachmentIds: [],
  };
}

/** Create or edit a task. Uploads go to storage straight away and are linked to the task when it is saved. */
export function TaskForm({
  task,
  projects,
  people,
  defaults = {},
  onDone,
  onCancel,
}: {
  task?: TaskDetail | null;
  projects: ProjectOption[];
  people: TeamMember[];
  defaults?: TaskDefaults;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(task);
  const isAdmin = useIsAdmin();
  // Phones: skip autofocus so the keyboard does not cover the form the moment it opens.
  const [focusTitle] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileDTO[]>(task?.attachments ?? []);
  // Fixed when the form opens, like `files`: a newer copy of the task must not turn files attached meanwhile into removals.
  const [initialIds] = useState(() => new Set((task?.attachments ?? []).map((f) => f.id)));

  const form = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: defaultsFrom(task, defaults),
    ...formValidation,
  });
  const { control } = form;

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.value,
        label: p.label,
        description: p.description,
        disabled: p.status === "cancelled" && p.value !== task?.project?.id,
        icon: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects, task],
  );
  const peopleOptions = useMemo(
    () =>
      people.map((m) => ({
        value: m.id,
        label: m.name,
        description: m.email,
        icon: (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand-ink">
            {initials(m.name)}
          </span>
        ),
      })),
    [people],
  );

  const discardNew = (list: FileDTO[]) => {
    const ids = list.filter((f) => !initialIds.has(f.id)).map((f) => f.id);
    if (ids.length) void discardUnsavedAttachments(ids);
  };

  function removeFile(file: FileDTO) {
    setFiles((list) => list.filter((f) => f.id !== file.id));
    discardNew([file]);
  }

  function cancel() {
    discardNew(files);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload = { ...values, attachmentIds: files.map((f) => f.id) };
      const removedAttachmentIds = [...initialIds].filter((id) => !files.some((f) => f.id === id));
      const result = task ? await updateTask({ ...payload, id: task.id, removedAttachmentIds }) : await createTask(payload);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5 max-md:min-h-[72dvh]">
        <TextField control={control} name="title" label="Title" required placeholder="What needs to be done" autoFocus={focusTitle} />
        <TextareaField control={control} name="description" label="Description" rows={5} placeholder="Context, links, acceptance criteria" />

        <div className="grid gap-4 sm:grid-cols-2">
          <ComboboxField
            control={control}
            name="assigneeId"
            label="Assigned to"
            options={peopleOptions}
            placeholder="Unassigned"
            searchPlaceholder="Search people…"
            clearable
          />
          <ComboboxField
            control={control}
            name="projectId"
            label="Project"
            options={projectOptions}
            placeholder="No project"
            searchPlaceholder="Search projects…"
            clearable
          />
          <SelectField control={control} name="priority" label="Priority" required options={TASK_PRIORITIES} />
          <DateField control={control} name="dueDate" label="Due date" clearable placeholder="No due date" />
          <SelectField control={control} name="status" label="Status" required options={TASK_STATUSES} />
        </div>

        <FormSection title="Attachments" description={`Drawings, specs, photos. Up to ${MAX_UPLOAD_LABEL} each; large photos are shrunk automatically.`} icon={<Paperclip />}>
          {files.length ? (
            <div className="space-y-2">
              {files.map((f) => (
                // Removing a saved attachment deletes it, which only admins may do. New uploads can always be taken off.
                <FileTile key={f.id} file={f} onRemove={isAdmin || !initialIds.has(f.id) ? () => removeFile(f) : undefined} />
              ))}
            </div>
          ) : null}
          <FileDropzone
            compact
            accept={ACCEPT_DOCUMENTS}
            meta={{ kind: "attachment" }}
            onUploaded={(f) => setFiles((list) => [...list, f])}
            title="Drop files or click to upload"
          />
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending} className="max-md:flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28 max-md:flex-[2]">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Create task"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
