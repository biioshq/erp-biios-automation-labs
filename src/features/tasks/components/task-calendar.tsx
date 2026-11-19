"use client";

import { useMemo } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTableUrl } from "@/components/data-table";
import { cn } from "@/lib/utils";
import { toDateInput } from "@/lib/dates";
import type { TaskPriority } from "@/lib/constants";
import type { TaskRow } from "../types";
import { PriorityBadge } from "@/components/shared/status-badge";
import { DueDate, PRIORITY_RULE, PersonAvatar, ProjectChip, dueLabel } from "./task-bits";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

const PILL: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground hover:bg-muted/70",
  medium: "bg-info/10 text-info hover:bg-info/15",
  high: "bg-warning/12 text-warning hover:bg-warning/18",
  urgent: "bg-danger/10 text-danger hover:bg-danger/15",
};

function Pill({ task, onOpen }: { task: TaskRow; onOpen: (id: string) => void }) {
  const done = task.status === "completed" || task.status === "cancelled";
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      title={`${task.number} · ${task.title}`}
      className={cn(
        "relative flex w-full items-center gap-1.5 overflow-hidden rounded-md py-1 pr-1.5 pl-2.5 text-left text-[11px] leading-tight font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        done ? "bg-muted/60 text-muted-foreground line-through" : task.overdue ? "bg-danger/15 text-danger ring-1 ring-danger/40 hover:bg-danger/20" : PILL[task.priority],
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", PRIORITY_RULE[task.priority])} aria-hidden />
      <span className="truncate">{task.title}</span>
    </button>
  );
}

/** Phones: one row per task, in the agenda list. */
function AgendaRow({ task, onOpen }: { task: TaskRow; onOpen: (id: string) => void }) {
  const done = task.status === "completed" || task.status === "cancelled";
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className={cn(
        "relative flex w-full items-start gap-3 py-3 pr-4 pl-5 text-left transition-colors active:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
        done && "opacity-70",
      )}
    >
      <span className={cn("absolute inset-y-2 left-2 w-1 rounded-full", PRIORITY_RULE[task.priority])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={cn("line-clamp-2 text-sm leading-snug font-medium", done && "line-through")}>{task.title}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{task.number}</span>
          {task.project ? <ProjectChip project={task.project} className="min-w-0" /> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <PriorityBadge priority={task.priority} />
          {!done ? <span className={cn("text-xs", task.overdue ? "font-medium text-danger" : "text-muted-foreground")}>{dueLabel(task.dueDate)}</span> : null}
          {done ? <DueDate task={task} /> : null}
        </div>
      </div>
      <PersonAvatar person={task.assignee} />
    </button>
  );
}

/** Phones: days that have tasks, grouped by date, in order. Empty days are left out. */
function Agenda({ days, today, onOpen }: { days: { key: string; tasks: TaskRow[] }[]; today: string; onOpen: (id: string) => void }) {
  if (days.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">No tasks are due this month.</p>;
  }
  return (
    <ol className="divide-y">
      {days.map(({ key, tasks }) => {
        const [yy, mm, dd] = key.split("-").map(Number) as [number, number, number];
        const date = new Date(yy, mm - 1, dd);
        const isToday = key === today;
        return (
          <li key={key}>
            <h3 className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
              <span className="eyebrow text-[10px]">{format(date, "EEE d MMM")}</span>
              {isToday ? <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Today</span> : null}
              <span className="tabular ml-auto text-xs text-muted-foreground">{tasks.length}</span>
            </h3>
            <ul className="divide-y">
              {tasks.map((t) => (
                <li key={t.id}>
                  <AgendaRow task={t} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

/** Month grid with tasks on their due dates (md and up); an agenda list on phones. Weeks start on Monday. */
export function TaskCalendar({
  rows,
  month,
  today,
  total,
  onOpen,
}: {
  rows: TaskRow[];
  /** "yyyy-mm" */
  month: string;
  /** "yyyy-mm-dd" in IST */
  today: string;
  total: number;
  onOpen: (id: string) => void;
}) {
  const url = useTableUrl();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const anchor = new Date(y, m - 1, 1);
  const currentMonth = today.slice(0, 7);

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of rows) {
      if (!t.dueDate) continue;
      const key = toDateInput(t.dueDate);
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [rows]);

  const agenda = useMemo(
    () =>
      [...byDay.entries()]
        .filter(([key]) => key.slice(0, 7) === month)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, tasks]) => ({ key, tasks })),
    [byDay, month],
  );

  const go = (target: string) => url.set({ month: target === currentMonth ? null : target }, { resetPage: false });
  const shift = (delta: number) => go(format(addMonths(anchor, delta), "yyyy-MM"));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{format(anchor, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="md:h-8" onClick={() => go(currentMonth)} disabled={month === currentMonth}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className={cn("overflow-hidden rounded-xl border bg-card shadow-card transition-opacity md:hidden", url.isPending && "opacity-60")}>
        <Agenda days={agenda} today={today} onOpen={onOpen} />
      </div>

      <div className={cn("hidden overflow-hidden rounded-xl border bg-card shadow-card transition-opacity md:block", url.isPending && "opacity-60")}>
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 border-b bg-muted/40">
              {WEEKDAYS.map((d) => (
                <div key={d} className="eyebrow px-2.5 py-2 text-[10px]">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const key = format(day, "yyyy-MM-dd");
                const tasks = byDay.get(key) ?? [];
                const inMonth = key.slice(0, 7) === month;
                const isToday = key === today;
                const shown = tasks.slice(0, MAX_PER_DAY);
                const hidden = tasks.length - shown.length;
                return (
                  <div
                    key={key}
                    className={cn(
                      "min-h-28 space-y-1 border-b border-l p-1.5 first:border-l-0 [&:nth-child(7n+1)]:border-l-0",
                      i >= days.length - 7 && "border-b-0",
                      !inMonth && "bg-muted/20",
                    )}
                  >
                    <div className="flex justify-end">
                      <span
                        className={cn(
                          "tabular flex size-6 items-center justify-center rounded-full text-xs",
                          isToday ? "bg-brand font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/60",
                        )}
                        aria-label={isToday ? `${format(day, "d MMMM")}, today` : undefined}
                      >
                        {format(day, "d")}
                      </span>
                    </div>
                    {shown.map((t) => (
                      <Pill key={t.id} task={t} onOpen={onOpen} />
                    ))}
                    {hidden > 0 ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="w-full rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted">
                            +{hidden} more
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 space-y-1.5 p-2">
                          <p className="eyebrow px-1 text-[10px]">{format(day, "EEEE, d MMMM")}</p>
                          {tasks.map((t) => (
                            <Pill key={t.id} task={t} onOpen={onOpen} />
                          ))}
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? "No tasks are due in this view. Tasks without a due date do not appear on the calendar."
          : "Tasks appear on their due date. Tasks without a due date are not shown."}
      </p>
    </div>
  );
}
