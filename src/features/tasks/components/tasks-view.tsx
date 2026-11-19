"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { FormSheet } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { TaskStatus } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import type { Paginated } from "@/lib/list-params";
import type { ProjectOption } from "@/server/lookups";
import type { TeamMember } from "@/server/services/users";
import { deleteTask, fetchTask } from "../actions";
import type { TaskView } from "../schemas";
import type { TaskDetail, TaskPerson, TaskRow } from "../types";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { TaskDetailSkeleton, TaskDetailView } from "./task-detail";
import { TaskFilterBar, ViewSwitcher, buildTaskFilters } from "./task-filters";
import { TaskForm, type TaskDefaults } from "./task-form";
import { TaskTable } from "./task-table";

type Panel = { kind: "new" } | { kind: "task"; id: string } | { kind: "edit"; id: string } | null;

export type TasksViewProps = {
  view: TaskView;
  /** The calendar route has no switcher: it always shows the calendar. */
  lockedView?: boolean;
  table?: Paginated<TaskRow>;
  board?: { rows: TaskRow[]; total: number; limit: number };
  calendar?: { rows: TaskRow[]; total: number; month: string };
  people: TeamMember[];
  projects: ProjectOption[];
  currentUser: TaskPerson;
  /** Filter keys the page fixes itself, so their chips are hidden. */
  hiddenFilters: string[];
  defaults: TaskDefaults;
  today: string;
  filtered: boolean;
};

/**
 * Table, board or calendar over the same filters, plus the task drawers.
 * Drawers follow the URL: ?new=1, ?task=<id>, ?edit=<id>.
 */
export function TasksView({ view, lockedView, table, board, calendar, people, projects, currentUser, hiddenFilters, defaults, today, filtered }: TasksViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<TaskRow | null>(null);
  const [newStatus, setNewStatus] = useState<TaskStatus | undefined>(undefined);

  const panel: Panel = useMemo(() => {
    if (searchParams.get("new") === "1") return { kind: "new" };
    const edit = searchParams.get("edit");
    if (edit) return { kind: "edit", id: edit };
    const task = searchParams.get("task");
    if (task) return { kind: "task", id: task };
    return null;
  }, [searchParams]);

  const setPanel = useCallback(
    (next: Panel) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      params.delete("task");
      params.delete("edit");
      if (next?.kind === "new") params.set("new", "1");
      if (next?.kind === "task") params.set("task", next.id);
      if (next?.kind === "edit") params.set("edit", next.id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const panelId = panel && panel.kind !== "new" ? panel.id : null;
  // Closing the drawer drops the cached task, so the next open shows fresh data.
  if (!panelId && detail) setDetail(null);
  useEffect(() => {
    if (!panelId) return;
    if (detail?.id === panelId) return;
    let cancelled = false;
    setLoading(true);
    fetchTask(panelId)
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          toast.error("That task no longer exists.");
          setPanel(null);
        }
        setDetail(d);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  const reload = useCallback(async () => {
    if (!panelId) return;
    setDetail(await fetchTask(panelId));
    router.refresh();
  }, [panelId, router]);

  async function remove(task: Pick<TaskRow, "id" | "number">) {
    const result = await deleteTask({ id: task.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`${task.number} deleted`);
    emitDataChanged();
    if (panelId === task.id) {
      setDetail(null);
      setPanel(null);
    }
    return true;
  }

  const openTask = useCallback((id: string) => setPanel({ kind: "task", id }), [setPanel]);
  const editTask = useCallback((id: string) => setPanel({ kind: "edit", id }), [setPanel]);
  const askDelete = useCallback((t: TaskRow) => setDeleting(t), []);
  const newTask = useCallback(
    (status?: TaskStatus) => {
      setNewStatus(status);
      setPanel({ kind: "new" });
    },
    [setPanel],
  );

  const filters = useMemo(() => buildTaskFilters({ projects, people, hidden: hiddenFilters }), [projects, people, hiddenFilters]);
  const switcher = lockedView ? null : <ViewSwitcher view={view} />;
  const ready = panel && panel.kind !== "new" && !loading && detail?.id === panel.id ? detail : null;

  return (
    <>
      {view === "table" && table ? (
        <TaskTable data={table} filters={filters} onOpen={openTask} onEdit={editTask} onDelete={askDelete} onNew={() => newTask()} toolbarActions={switcher} />
      ) : null}
      {view === "board" && board ? (
        <div className="space-y-4">
          <TaskFilterBar filters={filters}>{switcher}</TaskFilterBar>
          <TaskBoard rows={board.rows} total={board.total} limit={board.limit} filtered={filtered} onOpen={openTask} onNew={newTask} />
        </div>
      ) : null}
      {view === "calendar" && calendar ? (
        <div className="space-y-4">
          <TaskFilterBar filters={filters}>{switcher}</TaskFilterBar>
          <TaskCalendar rows={calendar.rows} month={calendar.month} today={today} total={calendar.total} onOpen={openTask} />
        </div>
      ) : null}

      <FormSheet
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        size={panel?.kind === "task" ? "md" : "lg"}
        title={panel?.kind === "new" ? "New task" : panel?.kind === "edit" ? "Edit task" : (ready?.title ?? "Task")}
        description={
          panel?.kind === "new" ? "Assign it, set a due date and attach files." : panel?.kind === "edit" ? detail?.number : (ready?.number ?? undefined)
        }
      >
        {panel?.kind === "new" ? (
          <TaskForm
            projects={projects}
            people={people}
            defaults={{ ...defaults, status: newStatus ?? defaults.status }}
            onDone={() => setPanel(null)}
            onCancel={() => setPanel(null)}
          />
        ) : panel && !ready ? (
          <TaskDetailSkeleton />
        ) : panel?.kind === "edit" && ready ? (
          <TaskForm
            key={ready.updatedAt}
            task={ready}
            projects={projects}
            people={people}
            onDone={(id) => {
              setDetail(null);
              setPanel({ kind: "task", id });
            }}
            onCancel={() => setPanel({ kind: "task", id: ready.id })}
          />
        ) : panel?.kind === "task" && ready ? (
          <TaskDetailView task={ready} currentUser={currentUser} onChanged={reload} onEdit={() => editTask(ready.id)} onDelete={() => remove(ready)} />
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this task?"
        description={deleting ? `${deleting.number} "${deleting.title}", its comments and attachments will be removed.` : undefined}
        onConfirm={() => (deleting ? remove(deleting) : false)}
      />
    </>
  );
}
