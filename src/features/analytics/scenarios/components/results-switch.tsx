"use client";

import { useState } from "react";
import { CircleAlert, History } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/format";
import type { ScenarioResults } from "../types";
import { ResultsView } from "./results-view";

/**
 * Today's figures, with the saved snapshot one click away. When they differ, says which
 * parameters moved; the saved figures stay as they were for comparison and history.
 */
export function ResultsSwitch({
  live,
  saved,
  savedAt,
  savedHidden,
  savedNote = null,
  liveError,
  changed,
}: {
  live: ScenarioResults | null;
  saved: ScenarioResults | null;
  savedAt: string | null;
  savedHidden: string | null;
  savedNote?: string | null;
  liveError: string | null;
  changed: string[];
}) {
  const [view, setView] = useState<"today" | "saved">(live ? "today" : "saved");
  const shown = view === "saved" ? saved : live;
  const savedLabel = savedAt ? `As saved on ${formatDateTime(savedAt)}` : "As saved";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Results</h2>
          <p className="text-sm text-muted-foreground">
            {view === "today" ? "Worked out now from today's records." : `${savedLabel}, kept for comparison.`}
          </p>
        </div>
        {saved && live ? (
          <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as "today" | "saved")}>
            <ToggleGroupItem value="today">With today&apos;s data</ToggleGroupItem>
            <ToggleGroupItem value="saved">{savedLabel}</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </div>

      {saved && live && changed.length ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <History className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0">
            Records have changed since this was saved. These figures differ: <span className="font-medium">{changed.join(", ")}</span>. Use <span className="font-medium">More, Update saved results</span> to keep today&apos;s figures.
          </p>
        </div>
      ) : null}
      {savedHidden || savedNote ? <p className="rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">{savedHidden ?? savedNote}</p> : null}
      {liveError ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <p className="min-w-0">
            Today&apos;s figures cannot be worked out: {liveError}
            {saved ? " The saved figures are shown." : ""}
          </p>
        </div>
      ) : null}

      {shown ? <ResultsView results={shown} /> : <EmptyState icon={CircleAlert} title="No results to show" description="Edit the scenario so its inputs point at records that still exist, then save it." />}
    </div>
  );
}
