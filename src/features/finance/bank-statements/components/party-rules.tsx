"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { FormSheet, FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { INCOME_CATEGORIES, PROJECT_STAGES, labelOf, type ProjectStage } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import type { PartyRuleRow, Picker } from "../types";
import { deletePartyRule, updatePartyRule } from "../actions";

const NONE = "__none";

type Options = { categories: Picker[]; projects: (Picker & { status: string })[] };

/**
 * The parties the statement review remembers, with what their lines became last time. People with
 * the bank statements edit permission can correct or forget one; the next review uses the change.
 */
export function PartyRules({ rows, options, canEdit }: { rows: PartyRuleRow[]; options: Options; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PartyRuleRow | null>(null);
  const [removing, setRemoving] = useState<PartyRuleRow | null>(null);
  const router = useRouter();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.party, r.key, r.token ?? "", r.categoryLabel ?? "", r.projectName ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [rows, query]);

  if (!rows.length) {
    return (
      <EmptyState
        compact
        title="Nothing remembered yet"
        description="When statement lines are added, the vendor or client, category and project chosen for each payee are remembered here and suggested next time."
      />
    );
  }

  async function remove(r: PartyRuleRow) {
    const res = await deletePartyRule({ id: r.id });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(res.message ?? "Removed");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names, categories, projects" className="pl-8" aria-label="Search remembered parties" />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>On the statement</TableHead>
              <TableHead>Is</TableHead>
              <TableHead className="w-40">Category</TableHead>
              <TableHead className="w-48">Project</TableHead>
              <TableHead className="w-28 text-right">Used</TableHead>
              {canEdit ? <TableHead className="w-24" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="max-w-[260px]">
                  <p className="font-mono text-xs [overflow-wrap:anywhere]">{r.key}</p>
                  {r.token && r.token !== r.key ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.token}</p> : null}
                </TableCell>
                <TableCell>
                  <p className="font-medium [overflow-wrap:anywhere]">{r.party}</p>
                  <StatusBadge tone={r.side === "out" ? "neutral" : "success"}>{r.side === "out" ? "Paid to (vendor)" : "Received from (client)"}</StatusBadge>
                </TableCell>
                <TableCell>{r.categoryLabel ?? <span className="text-muted-foreground">-</span>}</TableCell>
                <TableCell>
                  {r.projectName ? (
                    <span>
                      {r.projectName}
                      {r.stage ? <span className="text-muted-foreground"> · {labelOf(PROJECT_STAGES, r.stage)}</span> : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  <span className="block tabular-nums">{formatNumber(r.hits)}x</span>
                  {r.lastUsedAt ? <span className="block">{formatDate(r.lastUsedAt)}</span> : null}
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${r.party}`} onClick={() => setEditing(r)}>
                        <Pencil />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Forget ${r.party}`} onClick={() => setRemoving(r)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No remembered party matches the search.</p> : null}

      <RuleEditor rule={editing} options={options} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => (o ? null : setRemoving(null))}
        title={removing ? `Forget ${removing.party}?` : "Forget this party?"}
        description="Lines from this name are suggested from earlier expenses and keywords again. Records already added do not change."
        confirmLabel="Forget"
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </div>
  );
}

function RuleEditor({ rule, options, onClose, onSaved }: { rule: PartyRuleRow | null; options: Options; onClose: () => void; onSaved: () => void }) {
  return (
    <FormSheet open={rule !== null} onOpenChange={(o) => (o ? null : onClose())} title={rule ? `Remembered: ${rule.key}` : "Remembered party"} description="Used to suggest what this name's lines become.">
      {rule ? <RuleForm key={rule.id} rule={rule} options={options} onClose={onClose} onSaved={onSaved} /> : null}
    </FormSheet>
  );
}

function RuleForm({ rule, options, onClose, onSaved }: { rule: PartyRuleRow; options: Options; onClose: () => void; onSaved: () => void }) {
  const [party, setParty] = useState(rule.party);
  const [category, setCategory] = useState<string | undefined>(rule.category ?? undefined);
  const [projectId, setProjectId] = useState<string | undefined>(rule.projectId ?? undefined);
  const [stage, setStage] = useState<ProjectStage | undefined>(rule.stage ?? undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const out = rule.side === "out";
  const categories = out ? options.categories : INCOME_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));
  // A rule may keep a closed project it already had; new picks are open projects only.
  const projects = options.projects.filter((p) => (p.status !== "cancelled" && p.status !== "completed") || p.value === rule.projectId);

  function save() {
    setError(null);
    start(async () => {
      const res = await updatePartyRule({ id: rule.id, party, category, projectId, stage: out && projectId ? stage : undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      onSaved();
      onClose();
    });
  }

  return (
    <>
      <FormSheetBody className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="rule-party">{out ? "Vendor" : "Client"}</Label>
          <Input id="rule-party" value={party} maxLength={200} onChange={(e) => setParty(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-category">Category</Label>
          <Select value={category ?? NONE} onValueChange={(v) => setCategory(v === NONE ? undefined : v)}>
            <SelectTrigger id="rule-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not remembered</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rule-project">Project</Label>
            <Select
              value={projectId ?? NONE}
              onValueChange={(v) => {
                setProjectId(v === NONE ? undefined : v);
                if (v === NONE) setStage(undefined);
              }}
            >
              <SelectTrigger id="rule-project" className="w-full">
                <SelectValue />
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
          </div>
          {out && projectId ? (
            <div className="grid gap-1.5">
              <Label htmlFor="rule-stage">Stage</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as ProjectStage)}>
                <SelectTrigger id="rule-stage" className="w-full">
                  <SelectValue placeholder="Pick the stage" />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STAGES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">Only suggestions change. Records already added keep what they have.</p>
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending || !party.trim() || (out && Boolean(projectId) && !stage)}>
          Save
        </Button>
      </FormSheetFooter>
    </>
  );
}
