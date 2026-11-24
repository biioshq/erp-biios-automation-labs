"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { SelectField, TextField } from "@/components/forms/fields";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { addTeamMember } from "../actions";
import { teamMemberSchema, type TeamMemberInput, type TeamMemberValues } from "../schemas";
import { formValidation } from "@/components/forms/form-options";
import type { RoleOption } from "../types";

/**
 * For people with "settings.team:create": creates an account with a temporary password the person
 * changes after signing in. Roles beyond the actor's own role show but cannot be picked.
 */
export function AddMemberDialog({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const firstRole = roles.find((r) => r.value === "member" && !r.disabled)?.value ?? roles.find((r) => !r.disabled)?.value ?? "";
  const EMPTY: TeamMemberInput = { name: "", email: "", password: "", role: firstRole };
  const form = useForm<TeamMemberInput, unknown, TeamMemberValues>({
    resolver: zodResolver(teamMemberSchema),
    defaultValues: EMPTY,
    ...formValidation,
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await addTeamMember(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${values.name} was added to the team`);
      emitDataChanged();
      form.reset(EMPTY);
      setOpen(false);
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) form.reset(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button className="max-sm:w-full">
          <UserPlus /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add team member</DialogTitle>
            <DialogDescription>They can sign in with this email and the temporary password, then be assigned tasks.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField control={form.control} name="name" label="Full name" required placeholder="Asha Patil" />
            <TextField control={form.control} name="email" label="Email" type="email" required placeholder="asha@company.com" />
            <TextField
              control={form.control}
              name="password"
              label="Temporary password"
              type="password"
              required
              description="At least 8 characters. Share it with them directly."
            />
            <SelectField
              control={form.control}
              name="role"
              label="Role"
              required
              options={roles}
              description="The role decides which pages and actions they get. Roles and permissions lists what each role opens."
            />
          </div>
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-w-28">
              {pending ? <Spinner /> : null}
              Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
