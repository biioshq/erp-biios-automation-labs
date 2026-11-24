"use client";

import { useEffect, useMemo, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ComboboxField, DateField, NumberField, SelectField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { BUDGET_HEADS, DEPARTMENTS, PROJECT_STAGES } from "@/lib/constants";
import { budgetFormSchema } from "../../schemas";
import { headCategoryLabels } from "../../compute/budget-heads";
import { ScenarioFormShell } from "./form-shell";
import { fyBounds, metaDefaults, projectOptions, type TypeFormProps } from "./options";

type In = z.input<typeof budgetFormSchema>;
type Out = z.output<typeof budgetFormSchema>;

const SCOPES = [
  { value: "project", label: "A project" },
  { value: "department", label: "A department" },
  { value: "overall", label: "The whole business" },
];
const MODES = [
  { value: "amount", label: "Proposed budget" },
  { value: "change", label: "Increase or decrease" },
];

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  const fy = fyBounds();
  return {
    ...metaDefaults(initial),
    type: "budget",
    inputs: {
      scope: saved?.scope ?? "project",
      projectId: saved?.projectId ?? "",
      department: saved?.department,
      stage: saved?.stage,
      head: saved?.head,
      currentBudget: saved?.currentBudget ?? (undefined as unknown as number),
      mode: saved?.mode ?? "change",
      proposedBudget: saved?.proposedBudget,
      change: saved?.change,
      periodFrom: saved?.periodFrom ?? fy.from,
      periodTo: saved?.periodTo ?? fy.to,
    },
  };
}

/** 1.5 Budget planning. */
export function BudgetForm({ options, initial }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(budgetFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control, setValue } = form;
  const scope = useWatch({ control, name: "inputs.scope" });
  const mode = useWatch({ control, name: "inputs.mode" });
  const projectId = useWatch({ control, name: "inputs.projectId" });
  const stage = useWatch({ control, name: "inputs.stage" });
  const head = useWatch({ control, name: "inputs.head" });
  const projects = useMemo(() => projectOptions(options.projects), [options.projects]);

  // Picking a project or stage fills the current allocation from its recorded budget. A saved
  // scenario keeps its own figure until the project or stage is changed.
  const lastKey = useRef(`${String(initial?.inputs.projectId ?? "")}|${String(initial?.inputs.stage ?? "")}`);
  useEffect(() => {
    if (scope !== "project") return;
    const key = `${projectId ?? ""}|${stage ?? ""}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const p = options.projects.find((x) => x.value === projectId);
    if (!p) return;
    setValue("inputs.currentBudget", stage ? (p.stageBudgets[stage] ?? 0) : p.budget, { shouldDirty: true });
  }, [scope, projectId, stage, options.projects, setValue]);

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="Budget" description="The allocation to plan and the period it covers.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField control={control} name="inputs.scope" label="Budget for" options={SCOPES} />
          {scope === "project" ? (
            <ComboboxField control={control} name="inputs.projectId" label="Project" options={projects} placeholder="Pick a project" />
          ) : scope === "department" ? (
            <SelectField control={control} name="inputs.department" label="Department" options={DEPARTMENTS.map((d) => ({ ...d }))} />
          ) : (
            <div className="hidden md:block" />
          )}
          {scope === "project" ? (
            <SelectField control={control} name="inputs.stage" label="Stage" options={PROJECT_STAGES.map((s) => ({ ...s }))} placeholder="Whole project" clearable />
          ) : null}
          <SelectField
            control={control}
            name="inputs.head"
            label="Budget head"
            options={BUDGET_HEADS.map((h) => ({ ...h }))}
            placeholder="All heads"
            clearable
            description={head ? `Counts: ${headCategoryLabels(head)}.` : "Every expense category counts."}
          />
          <NumberField
            control={control}
            name="inputs.currentBudget"
            label="Current allocated budget"
            currency
            description={scope === "project" ? "Filled from the project or stage budget; change it if this head has its own allocation." : "No budget is recorded for this scope, so enter it."}
          />
          <SelectField control={control} name="inputs.mode" label="Revise as" options={MODES} />
          {mode === "amount" ? (
            <NumberField control={control} name="inputs.proposedBudget" label="Proposed budget" currency />
          ) : (
            <NumberField control={control} name="inputs.change" label="Change" currency allowNegative description="Use a minus sign to cut the allocation." />
          )}
          <DateField control={control} name="inputs.periodFrom" label="Period from" required />
          <DateField control={control} name="inputs.periodTo" label="Period to" required />
        </div>
      </Section>
    </ScenarioFormShell>
  );
}
