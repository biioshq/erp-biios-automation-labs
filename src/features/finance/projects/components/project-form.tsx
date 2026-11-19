"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Check, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { applyFieldErrors } from "@/lib/action-result";
import { PROJECT_STAGES, PROJECT_STATUSES } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import { createProject, updateProject } from "../actions";
import { PROJECT_COLORS, projectFormSchema, type ProjectFormInput, type ProjectFormValues } from "../schemas";
import type { ProjectRow } from "../types";
import { formValidation } from "@/components/forms/form-options";

function defaultsFrom(project?: ProjectRow | null): ProjectFormInput {
  const stages = Object.fromEntries(PROJECT_STAGES.map((s) => [s.value, project?.stageBudgets[s.value] || undefined]));
  return {
    name: project?.name ?? "",
    client: project?.client ?? "",
    description: project?.description ?? "",
    status: project?.status ?? "planning",
    budget: project?.budget ?? (undefined as unknown as number),
    startDate: project?.startDate ? toDateInput(project.startDate) : undefined,
    endDate: project?.endDate ? toDateInput(project.endDate) : undefined,
    color: project?.color ?? PROJECT_COLORS[0].value,
    stageBudgets: stages as ProjectFormInput["stageBudgets"],
  };
}

/** Create or edit a project: details, schedule, colour and an optional budget split by stage. */
export function ProjectForm({
  project,
  clients,
  onDone,
  onCancel,
}: {
  project?: ProjectRow | null;
  clients: string[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(project);
  const [pending, startTransition] = useTransition();
  const form = useForm<ProjectFormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: defaultsFrom(project),
    ...formValidation,
  });
  const { control, register, setValue, formState } = form;

  const budget = useWatch({ control, name: "budget" }) ?? 0;
  const stageBudgets = useWatch({ control, name: "stageBudgets" });
  const color = useWatch({ control, name: "color" });
  const allocated = round2(PROJECT_STAGES.reduce((sum, s) => sum + (stageBudgets?.[s.value] ?? 0), 0));
  const over = allocated > budget + 0.005;
  const ratio = budget > 0 ? Math.min(1, allocated / budget) : allocated > 0 ? 1 : 0;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = project ? await updateProject({ ...values, id: project.id }) : await createProject(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Project name" required autoFocus={!isEdit} placeholder="e.g. Villa automation, Pune" className="sm:col-span-2" />
          <Field className="gap-1.5">
            <FieldLabel htmlFor="client" className="text-[13px]">
              Client
            </FieldLabel>
            <Input id="client" list="project-clients" autoComplete="off" placeholder="Who is this for" {...register("client")} />
            <datalist id="project-clients">
              {clients.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <SelectField control={control} name="status" label="Status" required options={PROJECT_STATUSES} />
          <TextareaField control={control} name="description" label="Description" rows={3} placeholder="Scope, deliverables, anything the team should know" className="sm:col-span-2" />
        </div>

        <FormSection title="Budget and schedule" description="The budget is the cap every expense is measured against.">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField control={control} name="budget" label="Total budget" currency required className="sm:col-span-1" />
            <DateField control={control} name="startDate" label="Start date" clearable />
            <DateField control={control} name="endDate" label="End date" clearable />
          </div>
        </FormSection>

        <FormSection title="Colour" description="Shown on the card, in charts and next to expenses.">
          <div role="radiogroup" aria-label="Project colour" className="flex flex-wrap gap-2.5">
            {PROJECT_COLORS.map((c) => {
              const selected = color?.toLowerCase() === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => setValue("color", c.value, { shouldDirty: true })}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border-2 border-transparent text-white transition-transform hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    selected && "border-foreground ring-2 ring-background ring-inset",
                  )}
                  style={{ background: c.value }}
                >
                  {selected ? <Check className="size-4" /> : null}
                </button>
              );
            })}
          </div>
        </FormSection>

        <FormSection
          title="Stage budgets"
          description="Optional. Plan how the budget splits across stages to track variance."
          icon={<Layers />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {PROJECT_STAGES.map((s) => (
              <NumberField key={s.value} control={control} name={`stageBudgets.${s.value}`} label={s.label} currency />
            ))}
          </div>
          <div className="space-y-2 rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Allocated to stages</span>
              <span className="tabular">
                <Money value={allocated} className={cn("font-semibold", over && "text-danger")} /> <span className="text-muted-foreground">of</span>{" "}
                <Money value={budget} />
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Stage budget allocation"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(ratio * 100)}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div className={cn("h-full rounded-full transition-[width]", over ? "bg-danger" : "bg-info")} style={{ width: `${ratio * 100}%` }} />
            </div>
            {over ? (
              <p className="flex items-center gap-1.5 text-xs text-danger">
                <AlertTriangle className="size-3.5" /> Stage budgets add up to <Money value={round2(allocated - budget)} /> more than the total budget.
              </p>
            ) : allocated > 0 && allocated < budget ? (
              <p className="text-xs text-muted-foreground">
                <Money value={round2(budget - allocated)} /> of the budget is not assigned to a stage.
              </p>
            ) : null}
          </div>
        </FormSection>
        {formState.errors.root?.message ? <p className="text-sm text-destructive">{formState.errors.root.message}</p> : null}
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-32">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Create project"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
