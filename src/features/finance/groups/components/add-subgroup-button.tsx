"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { applyFieldErrors } from "@/lib/action-result";
import { useCan } from "@/components/current-user";
import { createSubgroup } from "../actions";
import { subgroupFormSchema, type SubgroupFormInput, type SubgroupFormValues } from "../schemas";
import type { GroupOption } from "../types";

/**
 * "+ Add subgroup": a small dialog for a name, description and details, placed under one of
 * `parents` (a built-in group or another subgroup). `onAdded` gets the new group's key.
 * Hidden for people without the subgroup create permission (the action checks it too).
 */
export function AddSubgroupButton({
  parents,
  defaultParent,
  label = "Add subgroup",
  variant = "outline",
  size = "sm",
  onAdded,
}: {
  /** Groups it may go under; the picker is hidden when there is only one. */
  parents: GroupOption[];
  defaultParent?: string;
  label?: string;
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default";
  onAdded?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const canAdd = useCan("finance.groups:create");
  const form = useForm<SubgroupFormInput, unknown, SubgroupFormValues>({
    resolver: zodResolver(subgroupFormSchema),
    defaultValues: { parent: defaultParent ?? parents[0]?.key ?? "", name: "", description: "", details: "" },
  });

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await createSubgroup(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.label} added`);
      setOpen(false);
      form.reset({ parent: values.parent, name: "", description: "", details: "" });
      onAdded?.(result.data.key);
      router.refresh();
    }),
  );

  if (!canAdd) return null;

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a subgroup</DialogTitle>
              <DialogDescription>It shows wherever its group does, and records can be filed under it straight away.</DialogDescription>
            </DialogHeader>
            {parents.length > 1 ? (
              <SelectField
                control={form.control}
                name="parent"
                label="Goes under"
                required
                options={parents.map((p) => ({ value: p.key, label: `${"  ".repeat(p.depth)}${p.label}` }))}
              />
            ) : null}
            <TextField control={form.control} name="name" label="Name" required placeholder="Solar equipment" />
            <TextareaField control={form.control} name="description" label="Description" placeholder="What goes in this group" />
            <TextareaField control={form.control} name="details" label="Details" placeholder="Useful life, policy, account code, anything worth keeping" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add subgroup"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
