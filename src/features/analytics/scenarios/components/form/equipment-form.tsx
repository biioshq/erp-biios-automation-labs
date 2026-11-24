"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ComboboxField, DateField, NumberField, SelectField, TextField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { equipmentFormSchema } from "../../schemas";
import { MultiComboboxField } from "./multi-combobox-field";
import { ScenarioFormShell } from "./form-shell";
import { inDays, metaDefaults, projectOptions, type TypeFormProps } from "./options";

type In = z.input<typeof equipmentFormSchema>;
type Out = z.output<typeof equipmentFormSchema>;

const ACQUISITION = [
  { value: "rent", label: "Rent the shortfall" },
  { value: "purchase", label: "Buy the shortfall" },
];

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  return {
    ...metaDefaults(initial),
    type: "equipment",
    inputs: {
      assetIds: saved?.assetIds ?? [],
      equipmentName: saved?.equipmentName ?? "",
      projectId: saved?.projectId ?? "",
      requiredQty: saved?.requiredQty ?? 1,
      usageFrom: saved?.usageFrom ?? inDays(7),
      usageTo: saved?.usageTo ?? inDays(37),
      acquisition: saved?.acquisition ?? "rent",
      unitCost: saved?.unitCost,
      expectedReturn: saved?.expectedReturn ?? "",
    },
  };
}

/** 1.7 Equipment requirement. */
export function EquipmentForm({ options, initial }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(equipmentFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control } = form;
  const acquisition = useWatch({ control, name: "inputs.acquisition" });
  const projects = useMemo(() => projectOptions(options.projects), [options.projects]);
  const equipment = useMemo(() => options.equipment.map((e) => ({ value: e.value, label: e.label, description: e.description })), [options.equipment]);

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="Equipment needed" description="Equipment from the fixed asset register: marked as equipment, or in plant and machinery or computers and electronics.">
        <div className="grid gap-4 md:grid-cols-2">
          {options.equipment.length ? (
            <MultiComboboxField control={control} name="inputs.assetIds" label="Equipment in the register" options={equipment} placeholder="Pick equipment" />
          ) : (
            <p className="text-xs text-muted-foreground md:col-span-2">
              No equipment is in the <Link href="/finance/assets/fixed" className="underline">fixed asset register</Link> yet. Type a name below; every unit then counts as needed from outside.
            </p>
          )}
          <TextField control={control} name="inputs.equipmentName" label="Or equipment name" placeholder="Cable puller" description="Matches register equipment by name when none is picked." />
          <ComboboxField control={control} name="inputs.projectId" label="Project" required options={projects} placeholder="Pick a project" />
          <NumberField control={control} name="inputs.requiredQty" label="Units required" step={1} />
          <DateField control={control} name="inputs.usageFrom" label="Needed from" required />
          <DateField control={control} name="inputs.usageTo" label="Needed until" required />
          <DateField control={control} name="inputs.expectedReturn" label="Expected return date" clearable />
          <SelectField control={control} name="inputs.acquisition" label="Cover a shortfall by" options={ACQUISITION} />
          <NumberField control={control} name="inputs.unitCost" label={acquisition === "rent" ? "Rent per unit per day" : "Purchase cost per unit"} currency />
        </div>
      </Section>
    </ScenarioFormShell>
  );
}
