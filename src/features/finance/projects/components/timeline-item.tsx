import Link from "next/link";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import type { TimelineEvent } from "../types";
import { TIMELINE_META } from "./timeline-meta";

/** One row of the activity feed. `showTime` is off for milestones, which are whole days. */
export function TimelineItem({ event, last, compact }: { event: TimelineEvent; last?: boolean; compact?: boolean }) {
  const meta = TIMELINE_META[event.kind];
  const Icon = meta.icon;
  const milestone = event.kind === "start" || event.kind === "end";
  const body = (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium [overflow-wrap:anywhere] sm:truncate">{event.title}</p>
        {event.detail ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere] sm:truncate">{event.detail}</p> : null}
        {compact && !milestone ? <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}</p> : null}
      </div>
      {event.amount ? <Money value={event.amount} className="shrink-0 text-sm font-semibold" /> : null}
    </div>
  );
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last ? <span className="absolute top-8 bottom-0 left-4 w-px -translate-x-1/2 bg-border" aria-hidden /> : null}
      <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full", meta.tone)}>
        <Icon className="size-4" />
      </span>
      {event.href ? (
        <Link href={event.href} className="-m-1 flex min-w-0 flex-1 rounded-lg p-1 transition-colors hover:bg-muted/50">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 py-0.5">{body}</div>
      )}
    </li>
  );
}
