"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BANK_LINE_ACTIONS, PROJECT_STAGES, type BankLineAction, type ProjectStage } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import type { StatementPickers } from "../types";

const NONE = "__none";

export type BulkChange =
  | { kind: "action"; action: BankLineAction }
  | { kind: "category"; category: string }
  | { kind: "project"; projectId: string | undefined; stage: ProjectStage | undefined };

/**
 * Changes for every ticked line at once. Each change lands only on the lines it fits: a category
 * on new expenses, a project on new expenses and income, an action on the side it belongs to.
 */
export function BulkBar({
  count,
  pickers,
  onApply,
  onClear,
}: {
  count: number;
  pickers: StatementPickers;
  onApply: (change: BulkChange) => void;
  onClear: () => void;
}) {
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [stage, setStage] = useState<ProjectStage | undefined>(undefined);
  const projects = pickers.projects.filter((p) => p.status !== "cancelled");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 p-2.5 text-sm">
      <span className="px-1 font-medium tabular-nums">{formatNumber(count)} ticked</span>
      <Select value="" onValueChange={(v) => onApply({ kind: "action", action: v as BankLineAction })}>
        <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Set what the ticked lines become">
          <SelectValue placeholder="Set action" />
        </SelectTrigger>
        <SelectContent>
          {BANK_LINE_ACTIONS.map((a) => (
            <SelectItem key={a.value} value={a.value}>
              {a.value === "match" ? "Already recorded (best match)" : a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value="" onValueChange={(v) => onApply({ kind: "category", category: v })}>
        <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Set the category of the ticked expenses">
          <SelectValue placeholder="Set expense category" />
        </SelectTrigger>
        <SelectContent>
          {pickers.categories.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={projectId ?? NONE} onValueChange={(v) => setProjectId(v === NONE ? undefined : v)}>
          <SelectTrigger size="sm" className="w-auto max-w-56 min-w-36" aria-label="Project for the ticked lines">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No project</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projectId ? (
          <Select value={stage ?? ""} onValueChange={(v) => setStage(v as ProjectStage)}>
            <SelectTrigger size="sm" className="w-auto min-w-32" aria-label="Stage for the ticked expenses">
              <SelectValue placeholder="Stage" />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_STAGES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={Boolean(projectId) && !stage}
          title={projectId && !stage ? "Pick the stage: every project expense belongs to one" : undefined}
          onClick={() => onApply({ kind: "project", projectId, stage: projectId ? stage : undefined })}
        >
          Set project
        </Button>
      </div>
      <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear ticks
      </Button>
    </div>
  );
}
