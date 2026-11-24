import Link from "next/link";
import { History } from "lucide-react";
import { Section } from "@/components/shared/page";
import { Money } from "@/components/shared/money";
import { PROJECT_STAGES, labelOf } from "@/lib/constants";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import type { ProjectMoveRow, RelocationRow } from "../types";

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground">
        <History className="size-4" />
      </span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function When({ date }: { date: string }) {
  return (
    <time dateTime={date} title={formatDate(date)} className="hidden w-24 text-xs text-muted-foreground sm:block">
      {formatRelative(date)}
    </time>
  );
}

function ProjectDot({ project }: { project: { name: string; color: string } | null }) {
  if (!project) return <span>Deleted project</span>;
  return (
    <>
      <span className="mr-1 inline-block size-1.5 rounded-full align-middle" style={{ background: project.color }} />
      {project.name}
    </>
  );
}

/** The last moves between projects, with the cost that went with them. */
export function RecentProjectMoves({ moves }: { moves: ProjectMoveRow[] }) {
  return (
    <Section
      title="Recent moves between projects"
      description="Most recent first. Each shows in the history as a return and an assignment."
      actions={
        <Link href="/inventory/movements?type=return" className="inline-flex min-h-8 items-center text-xs font-medium text-brand-ink hover:underline">
          Movements
        </Link>
      }
      contentClassName="p-0"
    >
      {moves.length === 0 ? (
        <Empty text="No stock has been moved between projects yet. The first move shows up here." />
      ) : (
        <ul className="divide-y">
          {moves.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
              <div className="min-w-0 max-w-full">
                {m.item.id ? (
                  <Link href={`/inventory/items/${m.item.id}`} className="block truncate text-sm font-medium hover:underline">
                    {m.item.name}
                  </Link>
                ) : (
                  <span className="block truncate text-sm font-medium text-muted-foreground">{m.item.name}</span>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  <ProjectDot project={m.from} /> → <ProjectDot project={m.to} />
                  {m.stage ? ` · ${labelOf(PROJECT_STAGES, m.stage)}` : ""}
                  {m.by ? ` · ${m.by}` : ""}
                </p>
              </div>
              <div className="tabular flex items-baseline gap-4 text-right text-sm">
                <span className="font-semibold">
                  {formatNumber(m.quantity)} {m.item.unit}
                </span>
                <Money value={m.value} className="text-muted-foreground sm:w-24" />
                <When date={m.date} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The last moves of items to another storage location. */
export function RecentRelocations({ rows }: { rows: RelocationRow[] }) {
  return (
    <Section
      title="Recent location moves"
      description="Most recent first"
      actions={
        <Link href="/inventory/movements?type=transfer" className="inline-flex min-h-8 items-center text-xs font-medium text-brand-ink hover:underline">
          View all
        </Link>
      }
      contentClassName="p-0"
    >
      {rows.length === 0 ? (
        <Empty text="No item has been moved to another location yet. The first move shows up here." />
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 sm:px-5">
              <div className="min-w-0 max-w-full">
                {r.item.id ? (
                  <Link href={`/inventory/items/${r.item.id}`} className="block truncate text-sm font-medium hover:underline">
                    {r.item.name}
                  </Link>
                ) : (
                  <span className="block truncate text-sm font-medium text-muted-foreground">{r.item.name}</span>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  {r.from ?? "No location"} → <span className="text-foreground">{r.to ?? "No location"}</span>
                  {r.by ? ` · ${r.by}` : ""}
                </p>
              </div>
              <div className="tabular flex items-baseline gap-4 text-right text-sm">
                <span className="font-semibold">
                  {formatNumber(r.quantity)} {r.item.unit}
                </span>
                <When date={r.date} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
