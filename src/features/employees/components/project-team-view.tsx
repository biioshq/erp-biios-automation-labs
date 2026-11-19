"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ChevronDown, MoreHorizontal, Pencil, Plus, UserMinus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ComboboxField, DateField, NumberField, TextField } from "@/components/forms/fields";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Section } from "@/components/shared/page";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { dateOrNotSet } from "../format";
import { cn } from "@/lib/utils";
import { addProjectMember, endProjectMember, updateProjectMember } from "../team-actions";
import { ROLE_SUGGESTIONS, addMemberSchema, updateMemberSchema, type AddMemberInput, type UpdateMemberInput } from "../schemas";
import type { TeamData, TeamMemberDTO } from "../types";
import { AllocationBar, EmployeeAvatar } from "./employee-bits";

const CHIP = "inline-flex min-h-10 items-center rounded-full border bg-surface px-3 text-xs transition-colors hover:bg-muted sm:min-h-8";

function RoleSuggestions({ onPick }: { onPick: (role: string) => void }) {
  return (
    <div className="-mt-2 flex flex-wrap gap-1.5" aria-label="Role suggestions">
      {ROLE_SUGGESTIONS.map((r) => (
        <button key={r} type="button" className={CHIP} onClick={() => onPick(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}

const DIALOG_CLASS = "max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-md";

function AddMemberDialog({ projectId, options, open, onOpenChange }: { projectId: string; options: TeamData["options"]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<AddMemberInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { projectId, employeeId: "", role: "", allocation: 100, startDate: toDateInput(new Date()) },
    mode: "onTouched",
  });
  const employeeId = useWatch({ control: form.control, name: "employeeId" });
  const allocation = useWatch({ control: form.control, name: "allocation" });
  const picked = options.find((o) => o.value === employeeId);
  const over = picked && typeof allocation === "number" ? picked.allocated + allocation : 0;

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await addProjectMember(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Added to the project team");
      emitDataChanged();
      form.reset({ projectId, employeeId: "", role: "", allocation: 100, startDate: toDateInput(new Date()) });
      onOpenChange(false);
    });
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>Pick a person, their role on this project and how much of their time it takes.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <ComboboxField
            control={form.control}
            name="employeeId"
            label="Employee"
            required
            placeholder="Pick an employee"
            searchPlaceholder="Search people…"
            emptyText="Everyone is already on this project."
            options={options.map((o) => ({ value: o.value, label: o.label, description: `${o.description}${o.description ? " · " : ""}${o.allocated}% allocated` }))}
            onSelected={(v) => {
              const o = options.find((x) => x.value === v);
              if (o) form.setValue("allocation", Math.min(100, Math.max(10, 100 - o.allocated)));
            }}
          />
          <TextField control={form.control} name="role" label="Role on this project" required placeholder="Installer" />
          <RoleSuggestions onPick={(r) => form.setValue("role", r, { shouldValidate: true })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={form.control} name="allocation" label="Allocation" required suffix="%" min={1} step={1} />
            <DateField control={form.control} name="startDate" label="Start date" required />
          </div>
          {over > 100 ? (
            <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
              {picked?.label} would be allocated {over}% across projects.
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-10 sm:h-9" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" className="h-10 sm:h-9" disabled={pending}>
              {pending ? <Spinner /> : null} Add to team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({ member, onClose }: { member: TeamMemberDTO | null; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<UpdateMemberInput>({
    resolver: zodResolver(updateMemberSchema),
    values: member ? { id: member.id, role: member.role, allocation: member.allocation } : undefined,
    mode: "onTouched",
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await updateProjectMember(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Membership updated");
      emitDataChanged();
      onClose();
    });
  });

  return (
    <Dialog open={member !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className={DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>Edit {member?.employee.name ?? "member"}</DialogTitle>
          <DialogDescription>Change their role or share of time on this project.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField control={form.control} name="role" label="Role on this project" required />
          <RoleSuggestions onPick={(r) => form.setValue("role", r, { shouldValidate: true })} />
          <NumberField control={form.control} name="allocation" label="Allocation" required suffix="%" min={1} step={1} />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-10 sm:h-9" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" className="h-10 sm:h-9" disabled={pending}>
              {pending ? <Spinner /> : null} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ m, past, onEdit, onEnd }: { m: TeamMemberDTO; past?: boolean; onEdit?: () => void; onEnd?: () => void }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:px-5">
      <EmployeeAvatar name={m.employee.name} department={m.employee.department} size="md" />
      <div className="grid min-w-0 flex-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <Link href={`/finance/employees/${m.employee.id}`} className="block truncate font-medium hover:underline">
            {m.employee.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">{m.employee.designation ?? m.employee.code}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex h-6 max-w-full items-center rounded-md border bg-surface px-2 text-xs">
            <span className="truncate">{m.role}</span>
          </span>
          <span className="tabular text-xs whitespace-nowrap text-muted-foreground">
            {past ? `${dateOrNotSet(m.startDate, "Start not set")} to ${dateOrNotSet(m.endDate)}` : `Since ${dateOrNotSet(m.startDate, "start date not set")}`}
          </span>
        </div>
        <AllocationBar value={m.allocation} className="max-w-48" />
      </div>
      {!past ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-10 shrink-0 sm:size-8" aria-label={`Actions for ${m.employee.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit role and allocation
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onEnd}>
              <UserMinus /> End membership
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

/** Client side of the project Team tab: the member list and its dialogs. */
export function ProjectTeamView({ projectId, team }: { projectId: string; team: TeamData }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TeamMemberDTO | null>(null);
  const [ending, setEnding] = useState<TeamMemberDTO | null>(null);
  const [showPast, setShowPast] = useState(false);
  const fte = team.totalAllocation / 100;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Section
        title="Team"
        description={
          team.current.length
            ? `${team.current.length} ${team.current.length === 1 ? "person" : "people"} · ${team.totalAllocation}% allocated in total (${fte.toFixed(fte % 1 === 0 ? 0 : 1)} full-time)`
            : "Nobody is assigned to this project yet."
        }
        actions={
          <Button variant="outline" onClick={() => setAdding(true)} className="h-10 w-full sm:h-9 sm:w-auto">
            <Plus /> Add member
          </Button>
        }
        contentClassName="p-0"
      >
        {team.current.length ? (
          <ul className="divide-y">
            {team.current.map((m) => (
              <MemberRow key={m.id} m={m} onEdit={() => setEditing(m)} onEnd={() => setEnding(m)} />
            ))}
          </ul>
        ) : (
          <div className="p-4 sm:p-5">
            <EmptyState
              compact
              icon={Users}
              title="No team yet"
              description="Add the people working on this project, with their role and how much of their time it takes."
              action={
                <Button variant="outline" onClick={() => setAdding(true)}>
                  <Plus /> Add member
                </Button>
              }
            />
          </div>
        )}
      </Section>

      {team.past.length ? (
        <Collapsible open={showPast} onOpenChange={setShowPast}>
          <div className="rounded-xl border bg-card shadow-card">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium sm:px-5">
                <span>Past members ({team.past.length})</span>
                <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showPast && "rotate-180")} aria-hidden />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y border-t">
                {team.past.map((m) => (
                  <MemberRow key={m.id} m={m} past />
                ))}
              </ul>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}

      <AddMemberDialog projectId={projectId} options={team.options} open={adding} onOpenChange={setAdding} />
      <EditMemberDialog member={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title="End this membership?"
        description={ending ? `${ending.employee.name} will move to past members, with today as their last day on this project.` : undefined}
        confirmLabel="End membership"
        onConfirm={async () => {
          if (!ending) return false;
          const result = await endProjectMember({ id: ending.id });
          if (!result.ok) {
            toast.error(result.error);
            return false;
          }
          toast.success(result.message ?? "Membership ended");
          emitDataChanged();
        }}
      />
    </div>
  );
}
