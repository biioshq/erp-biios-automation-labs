import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/shared/empty-state";
import { HISTORY_ACTIONS } from "../schemas";
import type { HistoryEntry } from "../types";
import { ScenarioStatusBadge } from "./badges";

/** A scenario's history, newest first: who did what, when, and what changed. */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) return <EmptyState compact title="No history yet" description="Changes, status moves and approvals show up here." />;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {entries.map((h, i) => (
        <li key={`${h.at}-${i}`} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-brand" aria-hidden />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">{HISTORY_ACTIONS.find((a) => a.value === h.action)?.label ?? h.action}</span>
            {h.status ? <ScenarioStatusBadge status={h.status} className="h-5 px-2 text-[11px]" /> : null}
            <span className="text-xs text-muted-foreground">
              {formatDateTime(h.at)}
              {h.byName ? ` · ${h.byName}` : ""}
            </span>
          </div>
          {h.changes.length ? (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {h.changes.map((c, j) => (
                <li key={j} className="[overflow-wrap:anywhere]">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          {h.note ? <p className="mt-1 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">Note: {h.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
