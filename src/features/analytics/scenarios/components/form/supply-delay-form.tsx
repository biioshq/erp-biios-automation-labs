"use client";

import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ComboboxField, DateField, NumberField, SelectField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { supplyDelayFormSchema } from "../../schemas";
import { NotRecordedNote } from "../results-view";
import { MultiComboboxField } from "./multi-combobox-field";
import { ScenarioFormShell } from "./form-shell";
import { inDays, itemOptions, itemPriceHint, metaDefaults, priceBasisOptions, projectOptions, type TypeFormProps } from "./options";

type In = z.input<typeof supplyDelayFormSchema>;
type Out = z.output<typeof supplyDelayFormSchema>;

const UNITS = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
];

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  return {
    ...metaDefaults(initial),
    type: "supply_delay",
    inputs: {
      vendor: saved?.vendor ?? "",
      itemId: saved?.itemId ?? "",
      originalDelivery: saved?.originalDelivery ?? inDays(7),
      delay: saved?.delay ?? 7,
      delayUnit: saved?.delayUnit ?? "days",
      orderQty: saved?.orderQty,
      projectIds: saved?.projectIds ?? [],
      priceBasis: saved?.priceBasis ?? "last_purchase",
    },
  };
}

/** 1.2 Supply delay. */
export function SupplyDelayForm({ options, initial }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(supplyDelayFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control } = form;
  const itemId = useWatch({ control, name: "inputs.itemId" });
  const item = options.items.find((i) => i.value === itemId);
  const items = useMemo(() => itemOptions(options.items), [options.items]);
  const projects = useMemo(() => projectOptions(options.projects), [options.projects]);
  const vendors = useMemo(() => options.vendors.map((v) => ({ value: v, label: v })), [options.vendors]);

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="Delivery" description="The material whose delivery is late, when it was expected and by how much it slips.">
        <div className="grid gap-4 md:grid-cols-2">
          <ComboboxField control={control} name="inputs.itemId" label="Material" required options={items} placeholder="Pick a material" description={itemPriceHint(item)} />
          <ComboboxField control={control} name="inputs.vendor" label="Vendor" options={vendors} placeholder="Pick a vendor" clearable />
          <DateField control={control} name="inputs.originalDelivery" label="Original expected delivery" required />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <NumberField control={control} name="inputs.delay" label="Delay" step={1} min={1} />
            <SelectField control={control} name="inputs.delayUnit" label="In" options={UNITS} />
          </div>
          <NumberField control={control} name="inputs.orderQty" label="Units in the delivery" suffix={item?.unit} description="Optional. Shown with the results." />
          <SelectField control={control} name="inputs.priceBasis" label="Price bridging stock at" options={priceBasisOptions} />
          <MultiComboboxField
            control={control}
            name="inputs.projectIds"
            label="Affected projects"
            options={projects}
            placeholder="Projects using the material are added for you"
            description="Projects issued this material in the last 90 days are always included."
            className="md:col-span-2"
          />
        </div>
      </Section>
      <NotRecordedNote label="Purchase orders" detail="The ERP does not record purchase orders, so pick the material and enter the delivery date yourself." />
    </ScenarioFormShell>
  );
}
