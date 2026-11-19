"use client";

import { useCallback, useMemo, useOptimistic, startTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Check, ChevronDown, ListTodo, MoreHorizontal, Pencil, Plus, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumnHeader, type FilterDef } from "@/components/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PriorityBadge, TaskStatusBadge } from "@/components/shared/status-badge";
import { TASK_STATUSES, labelOf, type TaskStatus } from "@/lib/constants";
import { isOverdue } from "@/lib/dates";
import { formatRelative } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import type { Paginated } from "@/lib/list-params";
import { setTaskStatus } from "../actions";
import type { TaskRow } from "../types";
import { DueDate, PersonAvatar, PersonName, ProjectChip, TaskCounts, dueLabel } from "./task-bits";
import { cn } from "@/lib/utils";

/** A status badge that opens a menu to change the status in place. */
function StatusMenu({ task, onChange }: { task: TaskRow; onChange: (status: TaskStatus) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status ${labelOf(TASK_STATUSES, task.status)}. Change status`}
          className="group inline-flex items-center gap-1 rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <TaskStatusBadge status={task.status} overdue={task.overdue} />
          <ChevronDown className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
        {TASK_STATUSES.map((s) => (
          <DropdownMenuItem key={s.value} onSelect={() => s.value !== task.status && onChange(s.value)}>
            {s.label}
            {s.value === task.status ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One task as a tappable card on phones: title, number and project, then priority, status, due date and assignee. */
function TaskMobileCard({ task }: { task: TaskRow }) {
  const done = task.status === "completed" || task.status === "cancelled";
  return (
    <div className={cn("flex items-start gap-3", done && "opacity-70")}>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{task.title}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{task.number}</span>
          {task.project ? <ProjectChip project={task.project} className="min-w-0" /> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <PriorityBadge priority={task.priority} />
          <TaskStatusBadge status={task.status} overdue={task.overdue} />
          <DueDate task={task} relative />
          <TaskCounts task={task} />
        </div>
      </div>
      <PersonAvatar person={task.assignee} />
    </div>
  );
}

export function TaskTable({
  data,
  filters,
  onOpen,
  onEdit,
  onDelete,
  onNew,
  toolbarActions,
}: {
  data: Paginated<TaskRow>;
  filters: FilterDef[];
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (task: TaskRow) => void;
  onNew: () => void;
  toolbarActions?: React.ReactNode;
}) {
  const [rows, setRowStatus] = useOptimistic(data.rows, (state, change: { id: string; status: TaskStatus }) =>
    state.map((r) =>
      r.id === change.id
        ? { ...r, status: change.status, overdue: change.status !== "completed" && change.status !== "cancelled" && isOverdue(r.dueDate) }
        : r,
    ),
  );

  const changeStatus = useCallback(
    (task: TaskRow, status: TaskStatus) => {
      startTransition(async () => {
        setRowStatus({ id: task.id, status });
        const result = await setTaskStatus({ id: task.id, status });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`${task.number} moved to ${labelOf(TASK_STATUSES, status)}`);
        emitDataChanged();
      });
    },
    [setRowStatus],
  );

  const columns = useMemo<ColumnDef<TaskRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        meta: { label: "Task" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Task" />,
        cell: ({ row }) => (
          <div className="min-w-56 max-w-md">
            <p className="truncate font-medium">{row.original.title}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{row.original.number}</p>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "project",
        meta: { label: "Project" },
        header: "Project",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.project ? (
            <ProjectChip project={row.original.project} className="min-w-32 text-sm text-foreground" />
          ) : (
            <span className="text-xs text-muted-foreground/70">No project</span>
          ),
      },
      {
        id: "assignee",
        meta: { label: "Assignee" },
        header: "Assignee",
        enableSorting: false,
        cell: ({ row }) => <PersonName person={row.original.assignee} className="min-w-36" />,
      },
      {
        id: "priority",
        accessorKey: "priority",
        meta: { label: "Priority" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      {
        id: "dueDate",
        accessorKey: "dueDate",
        meta: { label: "Due" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Due" />,
        cell: ({ row }) => (
          <div className="min-w-24">
            <DueDate task={row.original} className="text-sm" />
            {row.original.dueDate && row.original.status !== "completed" && row.original.status !== "cancelled" ? (
              <p className={row.original.overdue ? "text-[11px] text-danger" : "text-[11px] text-muted-foreground"}>
                {dueLabel(row.original.dueDate)}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <StatusMenu task={row.original} onChange={(s) => changeStatus(row.original, s)} />
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "activity",
        meta: { label: "Comments and files" },
        header: "Activity",
        enableSorting: false,
        cell: ({ row }) => <TaskCounts task={row.original} className="min-w-14" />,
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => <span suppressHydrationWarning className="text-xs whitespace-nowrap text-muted-foreground">{formatRelative(row.original.updatedAt)}</span>,
      },
      {
        id: "actions",
        meta: { align: "right", className: "w-12" },
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Task actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuLabel className="font-mono text-xs">{row.original.number}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onOpen(row.original.id)}>
                  <Eye /> Open
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEdit(row.original.id)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row.original)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [changeStatus, onOpen, onEdit, onDelete],
  );

  return (
    <DataTable
      id="tasks"
      mode="server"
      columns={columns}
      data={rows}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      filters={filters}
      dateRange={{ label: "Due date" }}
      searchPlaceholder="Search title, number, description…"
      getRowId={(r) => r.id}
      onRowClick={(r) => onOpen(r.id)}
      renderMobileRow={(r) => <TaskMobileCard task={r} />}
      initialHidden={["activity"]}
      rowClassName={(r) => (r.status === "completed" || r.status === "cancelled" ? "opacity-70" : undefined)}
      toolbarActions={toolbarActions}
      emptyState={
        <EmptyState
          icon={ListTodo}
          title="No tasks yet"
          description="Create the first task, assign it to a teammate and give it a due date."
          action={
            <Button onClick={onNew}>
              <Plus /> New task
            </Button>
          }
        />
      }
    />
  );
}
