"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { ArrowRightLeft, Check, ChevronDown, ChevronRight, Columns3, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { PriorityBadge } from "@/components/shared/status-badge";
import { TASK_STATUSES, labelOf, valuesOf, type TaskStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import { moveTask } from "../actions";
import type { TaskRow } from "../types";
import { DueDate, PRIORITY_RULE, PersonAvatar, ProjectChip, TaskCounts, daysUntil } from "./task-bits";

const STATUSES = valuesOf(TASK_STATUSES);
/** Side padding of the phone carousel in px (px-4). */
const CAROUSEL_PAD = 16;
type Columns = Record<TaskStatus, string[]>;
type Tasks = Record<string, TaskRow>;

const DOT: Record<TaskStatus, string> = {
  pending: "bg-muted-foreground",
  in_progress: "bg-info",
  review: "bg-chart-4",
  completed: "bg-success",
  cancelled: "bg-muted-foreground/50",
};

const columnKey = (s: TaskStatus) => `col:${s}`;
const isColumnKey = (id: string | number) => String(id).startsWith("col:");

function group(rows: TaskRow[]): Columns {
  const columns = Object.fromEntries(STATUSES.map((s) => [s, [] as string[]])) as Columns;
  // Array.sort is stable, so equal positions keep the server's order.
  for (const t of [...rows].sort((a, b) => a.order - b.order)) columns[t.status].push(t.id);
  return columns;
}

const toRecord = (rows: TaskRow[]): Tasks => Object.fromEntries(rows.map((t) => [t.id, t]));

/** Prefer what the pointer is over; fall back to rectangle overlap (keyboard drags, fast moves). */
const collision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length ? pointer : rectIntersection(args);
};

/** Stops taps and key presses inside the status menu from starting a drag or opening the card. */
const isolate = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/** The non-drag way to move a card: pick a column from a menu. */
function MoveMenu({ task, onMove }: { task: TaskRow; onMove: (status: TaskStatus) => void }) {
  return (
    <div {...isolate} className="ml-auto">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${task.number} is ${labelOf(TASK_STATUSES, task.status)}. Move to another status`}
            className="-my-2 -mr-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:h-7 md:px-2"
          >
            <ArrowRightLeft className="size-3.5" aria-hidden />
            Move
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
          {TASK_STATUSES.map((s) => (
            <DropdownMenuItem key={s.value} onSelect={() => s.value !== task.status && onMove(s.value)}>
              {s.label}
              {s.value === task.status ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Card({ task, onOpen, onMove, overlay }: { task: TaskRow; onOpen?: () => void; onMove?: (status: TaskStatus) => void; overlay?: boolean }) {
  const done = task.status === "completed" || task.status === "cancelled";
  return (
    <div
      onClick={onOpen}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 pl-3.5 text-left shadow-card transition-colors",
        overlay ? "cursor-grabbing shadow-pop ring-1 ring-brand/40" : "cursor-grab hover:border-foreground/20",
        done && "opacity-75",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", PRIORITY_RULE[task.priority])} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{task.title}</p>
        <PersonAvatar person={task.assignee} className="mt-0.5" />
      </div>
      {task.project ? <ProjectChip project={task.project} className="mt-1.5" /> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <PriorityBadge priority={task.priority} />
        {task.dueDate ? <DueDate task={task} /> : null}
        <TaskCounts task={task} className="ml-auto" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="font-mono text-[10px] text-muted-foreground/80">{task.number}</p>
        {onMove && !overlay ? <MoveMenu task={task} onMove={onMove} /> : null}
      </div>
    </div>
  );
}

function SortableCard({ task, onOpen, onMove }: { task: TaskRow; onOpen: () => void; onMove: (status: TaskStatus) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-md:select-none max-md:[-webkit-touch-callout:none]", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          onOpen();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <Card task={task} onOpen={onOpen} onMove={onMove} />
    </div>
  );
}

function Column({
  status,
  ids,
  tasks,
  collapsible,
  collapsed,
  onToggle,
  onOpen,
  onMove,
  onAdd,
}: {
  status: TaskStatus;
  ids: string[];
  tasks: Tasks;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  onOpen: (id: string) => void;
  onMove: (id: string, status: TaskStatus) => void;
  onAdd: (status: TaskStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnKey(status) });
  const label = labelOf(TASK_STATUSES, status);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${ids.length} tasks`}
      className={cn(
        "flex shrink-0 snap-start snap-always flex-col rounded-xl border bg-surface/50 transition-colors",
        collapsed ? "w-52 self-start" : "w-[85vw] max-w-[22rem] md:w-[300px] lg:w-[310px]",
        isOver && "border-brand/50 bg-brand/5",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        {collapsible ? (
          <Button variant="ghost" size="icon-sm" className="-ml-1.5 md:size-6" onClick={onToggle} aria-expanded={!collapsed} aria-label={`${collapsed ? "Show" : "Hide"} ${label} tasks`}>
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
        ) : null}
        <span className={cn("size-2 rounded-full", DOT[status])} aria-hidden />
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="tabular rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">{formatNumber(ids.length)}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto md:size-6" onClick={() => onAdd(status)} aria-label={`Add a task to ${label}`}>
          <Plus />
        </Button>
      </header>
      {collapsed ? null : (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
            {ids.map((id) => (tasks[id] ? <SortableCard key={id} task={tasks[id]} onOpen={() => onOpen(id)} onMove={(to) => onMove(id, to)} /> : null))}
            {ids.length === 0 ? (
              <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                Drop a task here
              </p>
            ) : null}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

/**
 * Kanban board. Dragging moves a card between columns (status) and within one (order).
 * The new position is the midpoint between its neighbours, saved optimistically and
 * rolled back if the server refuses.
 */
export function TaskBoard({
  rows,
  total,
  limit,
  filtered,
  onOpen,
  onNew,
}: {
  rows: TaskRow[];
  total: number;
  limit: number;
  filtered: boolean;
  onOpen: (id: string) => void;
  onNew: (status?: TaskStatus) => void;
}) {
  const [source, setSource] = useState(rows);
  const [tasks, setTasks] = useState<Tasks>(() => toRecord(rows));
  const [columns, setColumns] = useState<Columns>(() => group(rows));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const snapshot = useRef<{ columns: Columns; tasks: Tasks } | null>(null);

  // New data from the server replaces local state (unless a drag is in progress).
  if (source !== rows && !activeId) {
    setSource(rows);
    setTasks(toRecord(rows));
    setColumns(group(rows));
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const containerOf = useCallback(
    (id: string | number, from: Columns = columns): TaskStatus | undefined =>
      isColumnKey(id) ? (String(id).slice(4) as TaskStatus) : STATUSES.find((s) => from[s].includes(String(id))),
    [columns],
  );

  function onDragStart(e: DragStartEvent) {
    snapshot.current = { columns, tasks };
    setActiveId(String(e.active.id));
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const target = prev[to];
      let index = target.length;
      if (!isColumnKey(over.id)) {
        const overIndex = target.indexOf(String(over.id));
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        index = overIndex + (below ? 1 : 0);
      }
      return {
        ...prev,
        [from]: prev[from].filter((id) => id !== String(active.id)),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      };
    });
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const snap = snapshot.current;
    snapshot.current = null;
    setActiveId(null);
    if (!snap) return;
    if (!over) {
      setColumns(snap.columns);
      return;
    }
    const id = String(active.id);
    const status = containerOf(id);
    if (!status) return;

    let next = columns;
    if (containerOf(over.id) === status && !isColumnKey(over.id)) {
      const list = columns[status];
      const oldIndex = list.indexOf(id);
      const newIndex = list.indexOf(String(over.id));
      if (oldIndex !== newIndex && newIndex >= 0) next = { ...columns, [status]: arrayMove(list, oldIndex, newIndex) };
    }
    setColumns(next);

    const list = next[status];
    const index = list.indexOf(id);
    const before = snap.tasks[id];
    if (!before) return;
    if (before.status === status && snap.columns[status].indexOf(id) === index) return;

    const prev = index > 0 ? tasks[list[index - 1]!]?.order : undefined;
    const following = index < list.length - 1 ? tasks[list[index + 1]!]?.order : undefined;
    let order: number;
    let renumber: { id: string; order: number }[] | undefined;
    if (prev !== undefined && following !== undefined) {
      if (following - prev > 1e-6) order = (prev + following) / 2;
      else {
        // Neighbours share a position (never reordered before): number the whole column.
        renumber = list.map((tid, i) => ({ id: tid, order: i + 1 }));
        order = index + 1;
      }
    } else if (prev !== undefined) order = prev + 1;
    else if (following !== undefined) order = following - 1;
    else order = 1;

    const closed = status === "completed" || status === "cancelled";
    setTasks((current) => {
      const updated: Tasks = { ...current };
      for (const r of renumber ?? []) if (updated[r.id]) updated[r.id] = { ...updated[r.id]!, order: r.order };
      const t = updated[id]!;
      updated[id] = { ...t, status, order, overdue: !closed && t.dueDate ? daysUntil(t.dueDate) < 0 : false };
      return updated;
    });

    const result = await moveTask({ id, status, order, renumber });
    if (!result.ok) {
      toast.error(result.error);
      setColumns(snap.columns);
      setTasks(snap.tasks);
      return;
    }
    if (before.status !== status) toast.success(`${before.number} moved to ${labelOf(TASK_STATUSES, status)}`);
    emitDataChanged();
  }

  /** Moves a card to the end of another column without dragging (the menu on each card). */
  async function moveTo(id: string, status: TaskStatus) {
    const before = tasks[id];
    const from = containerOf(id);
    if (!before || !from || from === status) return;
    const snap = { columns, tasks };
    const last = columns[status][columns[status].length - 1];
    const order = (last ? (tasks[last]?.order ?? 0) : 0) + 1;
    const closed = status === "completed" || status === "cancelled";
    setColumns({ ...columns, [from]: columns[from].filter((x) => x !== id), [status]: [...columns[status], id] });
    setTasks({ ...tasks, [id]: { ...before, status, order, overdue: !closed && before.dueDate ? daysUntil(before.dueDate) < 0 : false } });
    const result = await moveTask({ id, status, order });
    if (!result.ok) {
      toast.error(result.error);
      setColumns(snap.columns);
      setTasks(snap.tasks);
      return;
    }
    toast.success(`${before.number} moved to ${labelOf(TASK_STATUSES, status)}`);
    emitDataChanged();
  }

  /** Phones: which column the carousel is showing, and a jump-to-column strip. */
  const scroller = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<TaskStatus>(STATUSES[0]!);

  const syncVisible = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    let best = 0;
    let bestDistance = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const distance = Math.abs((child as HTMLElement).offsetLeft - CAROUSEL_PAD - el.scrollLeft);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    setVisible(STATUSES[best] ?? STATUSES[0]!);
  }, []);

  function jumpTo(status: TaskStatus) {
    if (status === "cancelled") setShowCancelled(true);
    setVisible(status);
    const el = scroller.current;
    const target = el?.children[STATUSES.indexOf(status)] as HTMLElement | undefined;
    if (el && target) el.scrollTo({ left: Math.max(0, target.offsetLeft - CAROUSEL_PAD), behavior: "smooth" });
  }

  // Keep the active chip in view inside the strip.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>(`[data-status="${visible}"]`);
    const box = strip.current;
    if (!chip || !box) return;
    box.scrollTo({ left: chip.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2, behavior: "smooth" });
  }, [visible]);

  function onDragCancel() {
    if (snapshot.current) {
      setColumns(snapshot.current.columns);
      setTasks(snapshot.current.tasks);
    }
    snapshot.current = null;
    setActiveId(null);
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Columns3}
        title={filtered ? "No tasks match these filters" : "No tasks on the board yet"}
        description={filtered ? "Clear a filter or the search to see more tasks." : "Create a task and drag it across the columns as work moves on."}
        action={
          <Button onClick={() => onNew()}>
            <Plus /> New task
          </Button>
        }
      />
    );
  }

  const active = activeId ? tasks[activeId] : null;
  return (
    <div className="space-y-3">
      {total > limit ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
          Showing the {formatNumber(limit)} most recently updated of {formatNumber(total)} tasks. Use search or filters to narrow the board.
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          ref={strip}
          role="tablist"
          aria-label="Jump to a column"
          className="-mx-4 relative flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
        >
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              data-status={status}
              aria-selected={visible === status}
              onClick={() => jumpTo(status)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                visible === status ? "border-foreground/30 bg-card font-medium shadow-card" : "border-transparent bg-muted/60 text-muted-foreground",
              )}
            >
              <span className={cn("size-2 rounded-full", DOT[status])} aria-hidden />
              {labelOf(TASK_STATUSES, status)}
              <span className="tabular text-xs text-muted-foreground">{formatNumber(columns[status].length)}</span>
            </button>
          ))}
        </div>
        <div
          ref={scroller}
          onScroll={syncVisible}
          className={cn(
            "relative -mx-4 flex scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:snap-none md:gap-4 md:px-0",
            // Snapping fights the auto-scroll while a card is being dragged.
            activeId ? "snap-none" : "snap-x snap-mandatory",
          )}
        >
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              ids={columns[status]}
              tasks={tasks}
              collapsible={status === "cancelled"}
              collapsed={status === "cancelled" && !showCancelled}
              onToggle={() => setShowCancelled((v) => !v)}
              onOpen={onOpen}
              onMove={moveTo}
              onAdd={onNew}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180 }}>{active ? <Card task={active} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
