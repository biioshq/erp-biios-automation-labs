import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PriorityBadge } from "@/components/shared/status-badge";
import { formatRelative } from "@/lib/format";
import type { TaskRow } from "../types";
import { DueDate, PersonAvatar, ProjectChip } from "./task-bits";

/** Compact task rows for dashboard panels. Each row opens the task drawer. */
export function TaskList({ tasks, empty, showCompleted }: { tasks: TaskRow[]; empty: string; showCompleted?: boolean }) {
  if (!tasks.length) return <EmptyState compact title={empty} className="border-0 py-6" />;
  return (
    <ul className="-my-2 divide-y">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tasks/all?task=${t.id}`}
            className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium group-hover:text-foreground">{t.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <span className="font-mono text-[11px] text-muted-foreground">{t.number}</span>
                <ProjectChip project={t.project} />
                {showCompleted ? (
                  <span className="text-xs text-muted-foreground">{formatRelative(t.completedAt)}</span>
                ) : (
                  <DueDate task={t} relative />
                )}
              </div>
            </div>
            {showCompleted ? null : <PriorityBadge priority={t.priority} />}
            <PersonAvatar person={t.assignee} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
