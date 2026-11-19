import Link from "next/link";
import { AlertTriangle, FolderKanban, OctagonAlert } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { PROJECT_STATUSES, labelOf } from "@/lib/constants";
import { formatPercent } from "@/lib/format";
import type { BudgetRow } from "../types";

type Level = "ok" | "warning" | "danger";
const levelOf = (usage: number): Level => (usage > 1 ? "danger" : usage >= 0.8 ? "warning" : "ok");

const BAR: Record<Level, string> = { ok: "bg-chart-1", warning: "bg-warning", danger: "bg-danger" };

/** Spent against budget for every open project. 80% turns amber, over budget turns red. */
export function BudgetUsage({ rows }: { rows: BudgetRow[] }) {
  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon={FolderKanban}
        title="No project budgets yet"
        description="Create a project with a budget to see how much of it is spent."
        action={
          <Link href="/finance/projects?new=1" className="text-sm font-medium text-brand-ink hover:underline">
            New project
          </Link>
        }
      />
    );
  }
  return (
    <ul className="space-y-1">
      {rows.map((p) => {
        const level = levelOf(p.usage);
        const over = p.remaining < 0;
        return (
          <li key={p.id}>
            <Link
              href={`/finance/projects/${p.id}`}
              className="group block rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                  <span className="truncate">{p.name}</span>
                  {p.status !== "active" ? <span className="shrink-0 text-xs font-normal text-muted-foreground">{labelOf(PROJECT_STATUSES, p.status)}</span> : null}
                </span>
                <span
                  className={cn(
                    "tabular inline-flex shrink-0 items-center gap-1 text-xs font-medium",
                    level === "ok" && "text-muted-foreground",
                    level === "warning" && "text-warning",
                    level === "danger" && "text-danger",
                  )}
                >
                  {level === "danger" ? <OctagonAlert className="size-3.5" aria-hidden /> : level === "warning" ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
                  {p.budget > 0 ? formatPercent(p.usage) : "No budget"}
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-label={`${p.name} budget used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round(p.usage * 100))}
              >
                <div className={cn("h-full rounded-full transition-[width]", BAR[level])} style={{ width: `${p.budget > 0 ? Math.min(100, p.usage * 100) : p.spent > 0 ? 100 : 0}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  <Money value={p.spent} compact className="font-medium text-foreground" /> of <Money value={p.budget} compact />
                </span>
                <span className={cn(over && "font-medium text-danger")}>
                  {over ? (
                    <>
                      <Money value={Math.abs(p.remaining)} compact /> over
                    </>
                  ) : (
                    <>
                      <Money value={p.remaining} compact /> left
                    </>
                  )}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
