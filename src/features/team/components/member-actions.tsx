"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { KeyRound, MoreHorizontal, PencilLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { SelectField, TextField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { changeMemberRole, renameMember, setMemberPassword } from "../actions";
import {
  changeRoleSchema,
  renameMemberSchema,
  setPasswordSchema,
  type ChangeRoleInput,
  type RenameMemberInput,
  type RenameMemberValues,
  type SetPasswordInput,
  type SetPasswordValues,
} from "../schemas";
import type { RoleOption } from "../types";
import type { TeamListRow } from "./team-list";

type Dialogs = "role" | "name" | "password" | null;

/** The menu on a team row: change role, edit name, set a new password. Only the allowed items show. */
export function MemberActions({ member, roles }: { member: TeamListRow; roles: RoleOption[] }) {
  const [open, setOpen] = useState<Dialogs>(null);
  if (!member.canRename && !member.canChangeRole && !member.canSetPassword) return null;
  const close = () => setOpen(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`Manage ${member.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{member.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {member.canChangeRole ? (
            <DropdownMenuItem onSelect={() => setOpen("role")}>
              <ShieldCheck /> Change role
            </DropdownMenuItem>
          ) : null}
          {member.canRename ? (
            <DropdownMenuItem onSelect={() => setOpen("name")}>
              <PencilLine /> Edit name
            </DropdownMenuItem>
          ) : null}
          {member.canSetPassword ? (
            <DropdownMenuItem onSelect={() => setOpen("password")}>
              <KeyRound /> Set a new password
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === "role" ? <ChangeRoleDialog member={member} roles={roles} onClose={close} /> : null}
      {open === "name" ? <RenameDialog member={member} onClose={close} /> : null}
      {open === "password" ? <SetPasswordDialog member={member} onClose={close} /> : null}
    </>
  );
}

function useDone(onClose: () => void) {
  const router = useRouter();
  return (message: string) => {
    toast.success(message);
    emitDataChanged();
    onClose();
    router.refresh();
  };
}

function ChangeRoleDialog({ member, roles, onClose }: { member: TeamListRow; roles: RoleOption[]; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const done = useDone(onClose);
  const form = useForm<ChangeRoleInput>({
    resolver: zodResolver(changeRoleSchema),
    defaultValues: { userId: member.id, role: member.roleMissing ? "" : member.role },
    ...formValidation,
  });
  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await changeMemberRole(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      done(`${member.name} now has the ${result.data.name} role`);
    });
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              {member.name} gets the new role&apos;s pages and actions on their next page load. Roles beyond your own cannot be picked.
            </DialogDescription>
          </DialogHeader>
          <SelectField control={form.control} name="role" label="Role" required options={roles} />
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-w-28">
              {pending ? <Spinner /> : null}
              Save role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ member, onClose }: { member: TeamListRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const done = useDone(onClose);
  const form = useForm<RenameMemberInput, unknown, RenameMemberValues>({
    resolver: zodResolver(renameMemberSchema),
    defaultValues: { userId: member.id, name: member.name },
    ...formValidation,
  });
  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await renameMember(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      done("Name changed");
    });
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Edit name</DialogTitle>
            <DialogDescription>The name shows on tasks, records and the team list.</DialogDescription>
          </DialogHeader>
          <TextField control={form.control} name="name" label="Full name" required />
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-w-28">
              {pending ? <Spinner /> : null}
              Save name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({ member, onClose }: { member: TeamListRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const done = useDone(onClose);
  const form = useForm<SetPasswordInput, unknown, SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { userId: member.id, password: "", confirm: "", signOutOthers: true },
    ...formValidation,
  });
  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await setMemberPassword(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const parts = [result.data.created ? `${member.name} can now also sign in with a password` : `New password set for ${member.name}`];
      if (result.data.signedOut) parts.push("they were signed out everywhere");
      done(parts.join(", and "));
    });
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Set a new password</DialogTitle>
            <DialogDescription>
              For {member.name} ({member.email}). Share it with them directly. If they only sign in with Google, this adds a password sign-in too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField control={form.control} name="password" label="New password" type="password" required description="At least 8 characters." />
            <TextField control={form.control} name="confirm" label="New password again" type="password" required />
            <Controller
              control={form.control}
              name="signOutOthers"
              render={({ field }) => (
                <div className="flex items-start gap-3">
                  <Checkbox id="signOutOthers" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />
                  <div className="space-y-1">
                    <Label htmlFor="signOutOthers">Sign them out of other devices</Label>
                    <p className="text-xs text-muted-foreground">Every device they are signed in on has to sign in again with the new password.</p>
                  </div>
                </div>
              )}
            />
          </div>
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-w-28">
              {pending ? <Spinner /> : null}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
