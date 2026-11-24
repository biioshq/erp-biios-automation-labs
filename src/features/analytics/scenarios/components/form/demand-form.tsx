"use client";

import { useMemo, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { toast } from "sonner";
import { PackageSearch, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ComboboxField, DateField, NumberField, SelectField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchDemandPrefill } from "../../actions";
import { demandFormSchema } from "../../schemas";
import { MultiComboboxField } from "./multi-combobox-field";
import { ScenarioFormShell } from "./form-shell";
import { itemOptions, itemPriceHint, metaDefaults, priceBasisOptions, projectOptions, type TypeFormProps } from "./options";

type In = z.input<typeof demandFormSchema>;
type Out = z.output<typeof demandFormSchema>;

const MODES = [
  { value: "percent", label: "Percentage change" },
  { value: "quantity", label: "Revised quantity per material" },
];

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  return {
    ...metaDefaults(initial),
    type: "demand",
    inputs: {
      projectIds: saved?.projectIds ?? [],
      materials: saved?.materials ?? [{ itemId: "", currentRequirement: undefined as unknown as number }],
      mode: saved?.mode ?? "percent",
      percent: saved?.percent ?? 10,
      priceBasis: saved?.priceBasis ?? "last_purchase",
      periodFrom: saved?.periodFrom ?? "",
      periodTo: saved?.periodTo ?? "",
    },
  };
}

/** 1.1 Demand change. */
export function DemandForm({ options, initial }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(demandFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control, setValue, getValues } = form;
  const lines = useFieldArray({ control, name: "inputs.materials" });
  const mode = useWatch({ control, name: "inputs.mode" });
  const materials = useWatch({ control, name: "inputs.materials" });
  const projects = useMemo(() => projectOptions(options.projects), [options.projects]);
  const items = useMemo(() => itemOptions(options.items), [options.items]);
  const byId = useMemo(() => new Map(options.items.map((i) => [i.value, i])), [options.items]);
  const [filling, startFill] = useTransition();

  /** Fills the requirement of each listed material with what the chosen projects already used. */
  function fillFromUse(only?: number) {
    const projectIds = getValues("inputs.projectIds") ?? [];
    const rows = getValues("inputs.materials") ?? [];
    const itemIds = rows.map((r) => r.itemId).filter(Boolean);
    if (!projectIds.length || !itemIds.length) {
      if (only === undefined) toast.error("Pick projects and materials first.");
      return;
    }
    startFill(async () => {
      const result = await fetchDemandPrefill({ projectIds, itemIds });
      if (!result.ok) return void toast.error(result.error);
      rows.forEach((r, i) => {
        if (only !== undefined && i !== only) return;
        setValue(`inputs.materials.${i}.currentRequirement`, result.data[r.itemId] ?? 0, { shouldDirty: true });
      });
      if (only === undefined) toast.success("Requirements filled from what these projects used so far");
    });
  }

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="Projects and change" description="The projects whose demand changes, and by how much.">
        <div className="grid gap-4 md:grid-cols-2">
          <MultiComboboxField control={control} name="inputs.projectIds" label="Projects" options={projects} placeholder="Pick projects" className="md:col-span-2" />
          <SelectField control={control} name="inputs.mode" label="Change as" options={MODES} />
          {mode === "percent" ? (
            <NumberField control={control} name="inputs.percent" label="Expected change" suffix="%" allowNegative step="any" description="Use a minus sign for a decrease, e.g. -15." />
          ) : (
            <div className="hidden md:block" />
          )}
          <SelectField control={control} name="inputs.priceBasis" label="Price materials at" options={priceBasisOptions} />
          <div className="grid grid-cols-2 gap-3">
            <DateField control={control} name="inputs.periodFrom" label="Period from" clearable />
            <DateField control={control} name="inputs.periodTo" label="Period to" clearable />
          </div>
        </div>
      </Section>

      <Section
        title="Materials"
        description="Current requirement starts from what the chosen projects already used (net of returns); change it to the planned figure."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => fillFromUse()} disabled={filling}>
            {filling ? <Spinner /> : <RefreshCw />} Fill from project use
          </Button>
        }
      >
        {options.items.length === 0 ? (
          <EmptyState compact icon={PackageSearch} title="No inventory items yet" description="Add items in Inventory first; demand scenarios work on recorded materials." />
        ) : (
          <div className="space-y-3">
            {lines.fields.map((f, i) => {
              const item = byId.get(materials?.[i]?.itemId ?? "");
              return (
                <div key={f.id} className="grid gap-3 rounded-xl border bg-surface/40 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                  <ComboboxField
                    control={control}
                    name={`inputs.materials.${i}.itemId`}
                    label="Material"
                    options={items}
                    placeholder="Pick a material"
                    description={itemPriceHint(item)}
                    onSelected={(v) => v && materials?.[i]?.currentRequirement === undefined && fillFromUse(i)}
                  />
                  <NumberField control={control} name={`inputs.materials.${i}.currentRequirement`} label="Current requirement" suffix={item?.unit} />
                  {mode === "quantity" ? <NumberField control={control} name={`inputs.materials.${i}.revisedQty`} label="Revised quantity" suffix={item?.unit} /> : <div className="hidden sm:block" />}
                  <Button type="button" variant="ghost" size="icon" className="sm:mt-6" aria-label="Remove material" disabled={lines.fields.length === 1} onClick={() => lines.remove(i)}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => lines.append({ itemId: "", currentRequirement: undefined as unknown as number })} disabled={lines.fields.length >= 40}>
              <Plus /> Add material
            </Button>
          </div>
        )}
      </Section>
    </ScenarioFormShell>
  );
}
