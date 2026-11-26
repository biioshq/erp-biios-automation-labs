"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NumberField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { applyFieldErrors } from "@/lib/action-result";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setProjectBudget } from "../actions";
import { projectBudgetSchema, type ProjectBudgetInput, type ProjectBudgetValues } from "../schemas";

type Target = { id: string; name: string; budget: number; spent?: number };

/**
 * "Edit budget": changes only the project's allocated budget, with the same guard and budget
 * history as the project form. Shown only with the projects edit permission (the server checks again).
 */
export function EditBudgetButton({ project, variant = "icon", className }: { project: Target; variant?: "icon" | "button"; className?: string }) {
  const canEdit = useCan("finance.projects:edit");
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  // Clicks and keys inside the dialog bubble through the React tree to a clickable table row: stopped here.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className={className}
          aria-label={`Edit the budget of ${project.name}`}
          title="Edit budget"
          onClick={() => setOpen(true)}
        >
          <Pencil />
        </Button>
      ) : (
        <Button variant="outline" size="sm" className={className} onClick={() => setOpen(true)}>
          <Pencil /> Edit budget
        </Button>
      )}
      {open ? <EditBudgetDialog project={project} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function EditBudgetDialog({ project, onClose }: { project: Target; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ProjectBudgetInput, unknown, ProjectBudgetValues>({
    resolver: zodResolver(projectBudgetSchema),
    defaultValues: { id: project.id, budget: project.budget, expectedBudget: project.budget, note: "" },
    ...formValidation,
  });
  const budget = useWatch({ control: form.control, name: "budget" });
  const changed = typeof budget === "number" && round2(budget) !== round2(project.budget);
  const remaining = typeof budget === "number" && project.spent !== undefined ? round2(budget - project.spent) : null;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await setProjectBudget(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.changed ? `Budget of ${project.name} updated` : "The budget is unchanged");
      emitDataChanged();
      router.refresh();
      onClose();
    });
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit budget</DialogTitle>
            <DialogDescription>
              {project.name}. The current budget is <Money value={project.budget} />. It is kept in the budget history when you change it.
            </DialogDescription>
          </DialogHeader>
          <NumberField control={form.control} name="budget" label="Allocated budget" currency required />
          {remaining !== null ? (
            <p className={cn("-mt-2 text-xs", remaining < 0 ? "text-danger" : "text-muted-foreground")}>
              {remaining < 0 ? (
                <>
                  <Money value={Math.abs(remaining)} /> less than already incurred (<Money value={project.spent ?? 0} />)
                </>
              ) : (
                <>
                  <Money value={remaining} /> left after <Money value={project.spent ?? 0} /> incurred
                </>
              )}
            </p>
          ) : null}
          {changed ? <TextareaField control={form.control} name="note" label="Reason for the change" rows={2} placeholder="Optional, kept in the budget history" /> : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !changed}>
              {pending ? <Spinner /> : null}
              Save budget
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
