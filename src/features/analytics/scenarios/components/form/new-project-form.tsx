"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComboboxField, DateField, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { DEPARTMENTS } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";
import { newProjectFormSchema } from "../../schemas";
import { ScenarioFormShell } from "./form-shell";
import { inDays, itemOptions, itemPriceHint, metaDefaults, priceBasisOptions, type TypeFormProps } from "./options";

type In = z.input<typeof newProjectFormSchema>;
type Out = z.output<typeof newProjectFormSchema>;

const NO_NUMBER = undefined as unknown as number;

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  return {
    ...metaDefaults(initial),
    type: "new_project",
    inputs: {
      projectName: saved?.projectName ?? "",
      startDate: saved?.startDate ?? inDays(14),
      endDate: saved?.endDate ?? inDays(104),
      scope: saved?.scope ?? "",
      size: saved?.size ?? "",
      materials: saved?.materials ?? [],
      equipment: saved?.equipment ?? [],
      manpower: saved?.manpower ?? [],
      labourCost: saved?.labourCost,
      materialCost: saved?.materialCost,
      equipmentCost: saved?.equipmentCost,
      otherCost: saved?.otherCost,
      proposedBudget: saved?.proposedBudget,
      priceBasis: saved?.priceBasis ?? "last_purchase",
    },
  };
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="sm:mt-6" aria-label="Remove line" onClick={onClick}>
      <Trash2 />
    </Button>
  );
}

/** 1.3 New project: planned against what the company has. It never creates a project. */
export function NewProjectForm({ options, initial, isAdmin }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(newProjectFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control } = form;
  const materials = useFieldArray({ control, name: "inputs.materials" });
  const equipment = useFieldArray({ control, name: "inputs.equipment" });
  const manpower = useFieldArray({ control, name: "inputs.manpower" });
  const materialRows = useWatch({ control, name: "inputs.materials" });
  const items = useMemo(() => itemOptions(options.items), [options.items]);
  const byId = useMemo(() => new Map(options.items.map((i) => [i.value, i])), [options.items]);
  const assets = useMemo(() => options.equipment.map((e) => ({ value: e.value, label: e.label, description: e.description })), [options.equipment]);
  const departments = useMemo(
    () =>
      DEPARTMENTS.map((d) => {
        const info = options.departments.find((x) => x.value === d.value);
        return { value: d.value, label: d.label, description: info ? `${info.active} active${info.averageSalary !== null ? ` · avg ${formatCurrency(info.averageSalary)} a month` : ""}` : undefined };
      }),
    [options.departments],
  );

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="The project" description="A project that does not exist yet. Saving the scenario does not create it.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField control={control} name="inputs.projectName" label="Project name" required className="md:col-span-2" />
          <DateField control={control} name="inputs.startDate" label="Start" required />
          <DateField control={control} name="inputs.endDate" label="End" required />
          <TextareaField control={control} name="inputs.scope" label="Scope" placeholder="What the project covers" />
          <TextField control={control} name="inputs.size" label="Size" placeholder="e.g. 14 rooms, 3,200 sq ft" />
        </div>
      </Section>

      <Section title="Materials" description="Checked against stock in storage today.">
        <div className="space-y-3">
          {materials.fields.map((f, i) => {
            const item = byId.get(materialRows?.[i]?.itemId ?? "");
            return (
              <div key={f.id} className="grid gap-3 rounded-xl border bg-surface/40 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start">
                <ComboboxField control={control} name={`inputs.materials.${i}.itemId`} label="Material" options={items} placeholder="Pick a material" description={itemPriceHint(item)} />
                <NumberField control={control} name={`inputs.materials.${i}.qty`} label="Quantity" suffix={item?.unit} />
                <RemoveButton onClick={() => materials.remove(i)} />
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => materials.append({ itemId: "", qty: NO_NUMBER })}>
            <Plus /> Add material
          </Button>
        </div>
      </Section>

      <Section title="Equipment" description="Pick from the fixed asset register, or type a name for equipment the company does not have.">
        <div className="space-y-3">
          {options.equipment.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No equipment is in the <Link href="/finance/assets/fixed" className="underline">fixed asset register</Link> yet, so typed equipment counts as not available.
            </p>
          ) : null}
          {equipment.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-xl border bg-surface/40 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start">
              <ComboboxField control={control} name={`inputs.equipment.${i}.assetId`} label="From the register" options={assets} placeholder="Pick equipment" clearable />
              <TextField control={control} name={`inputs.equipment.${i}.name`} label="Or name" placeholder="Scissor lift" />
              <NumberField control={control} name={`inputs.equipment.${i}.qty`} label="Units" step={1} />
              <RemoveButton onClick={() => equipment.remove(i)} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => equipment.append({ assetId: "", name: "", qty: 1 })}>
            <Plus /> Add equipment
          </Button>
        </div>
      </Section>

      <Section title="Manpower" description="People needed by department, checked against free time on record.">
        <div className="space-y-3">
          {manpower.fields.map((f, i) => (
            <div key={f.id} className="grid gap-3 rounded-xl border bg-surface/40 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
              <SelectField control={control} name={`inputs.manpower.${i}.department`} label="Department" options={departments} />
              <TextField control={control} name={`inputs.manpower.${i}.role`} label="Role" placeholder="Installer" />
              <NumberField control={control} name={`inputs.manpower.${i}.count`} label="People" step={1} />
              <NumberField control={control} name={`inputs.manpower.${i}.months`} label="Months" step="any" />
              <RemoveButton onClick={() => manpower.remove(i)} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => manpower.append({ department: "installation", role: "", count: 1, months: 1 })}>
            <Plus /> Add people
          </Button>
        </div>
      </Section>

      <Section
        title="Costs and budget"
        description={
          isAdmin
            ? "Leave a cost empty to use the ERP's own estimate: materials at stock prices, labour at the department's average salary."
            : "Leave the material cost empty to use stock prices. Labour is only estimated from salaries for admins, so enter it here."
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <NumberField control={control} name="inputs.labourCost" label="Labour cost" currency />
          <NumberField control={control} name="inputs.materialCost" label="Material cost" currency />
          <NumberField control={control} name="inputs.equipmentCost" label="Equipment cost" currency />
          <NumberField control={control} name="inputs.otherCost" label="Other costs" currency />
          <NumberField control={control} name="inputs.proposedBudget" label="Proposed budget" currency />
          <SelectField control={control} name="inputs.priceBasis" label="Price materials at" options={priceBasisOptions} />
        </div>
      </Section>
    </ScenarioFormShell>
  );
}
