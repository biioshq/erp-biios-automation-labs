"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { SelectField, TextField, TextareaField, type Option } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { createRole } from "../actions";
import { createRoleSchema, type CreateRoleInput, type CreateRoleValues } from "../schemas";

const NONE = "none";

/** Creates a custom role, empty or starting from another role's permissions, then opens its permissions. */
export function NewRoleDialog({ roles }: { roles: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const empty: CreateRoleInput = { name: "", description: "", copyFrom: NONE };
  const form = useForm<CreateRoleInput, unknown, CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: empty,
    ...formValidation,
  });
  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createRole({ ...values, copyFrom: values.copyFrom === NONE ? "" : values.copyFrom });
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${values.name} was created. Now tick what it may do.`);
      setOpen(false);
      form.reset(empty);
      router.push(`/settings/roles/${result.data.key}`);
    });
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setOpen(o);
        if (!o) form.reset(empty);
      }}
    >
      <DialogTrigger asChild>
        <Button className="max-sm:w-full">
          <Plus /> New role
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>Name the role, then choose its permissions on the next page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField control={form.control} name="name" label="Name" required placeholder="Site supervisor" />
            <TextareaField control={form.control} name="description" label="Description" placeholder="Who this role is for" rows={2} />
            <SelectField
              control={form.control}
              name="copyFrom"
              label="Start from"
              options={[{ value: NONE, label: "No permissions" }, ...roles.map((r) => ({ ...r, label: `Same as ${r.label}` }))]}
              description="Copies that role's permissions as a starting point. Roles beyond your own cannot be copied."
            />
          </div>
          <DialogFooter className="max-sm:flex-col-reverse">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="min-w-28">
              {pending ? <Spinner /> : null}
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
