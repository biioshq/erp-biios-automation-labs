"use client";

import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ComboboxField, NumberField, SelectField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Section } from "@/components/shared/page";
import { priceFormSchema } from "../../schemas";
import { MultiComboboxField } from "./multi-combobox-field";
import { ScenarioFormShell } from "./form-shell";
import { itemOptions, itemPriceHint, metaDefaults, priceBasisOptions, projectOptions, type TypeFormProps } from "./options";

type In = z.input<typeof priceFormSchema>;
type Out = z.output<typeof priceFormSchema>;

const MODES = [
  { value: "percent", label: "Percentage change" },
  { value: "price", label: "Revised price" },
];

function defaults(initial: TypeFormProps["initial"]): In {
  const saved = initial?.inputs as Partial<In["inputs"]> | undefined;
  return {
    ...metaDefaults(initial),
    type: "price",
    inputs: {
      itemId: saved?.itemId ?? "",
      currentBasis: saved?.currentBasis ?? "last_purchase",
      mode: saved?.mode ?? "percent",
      revisedPrice: saved?.revisedPrice,
      percent: saved?.percent ?? 10,
      expectedQty: saved?.expectedQty ?? (undefined as unknown as number),
      projectIds: saved?.projectIds ?? [],
    },
  };
}

/** 1.4 Purchase price change. */
export function PriceForm({ options, initial }: TypeFormProps) {
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(priceFormSchema), defaultValues: defaults(initial), ...formValidation });
  const { control } = form;
  const itemId = useWatch({ control, name: "inputs.itemId" });
  const mode = useWatch({ control, name: "inputs.mode" });
  const item = options.items.find((i) => i.value === itemId);
  const items = useMemo(() => itemOptions(options.items), [options.items]);
  const projects = useMemo(() => projectOptions(options.projects), [options.projects]);

  return (
    <ScenarioFormShell form={form} scenarioId={initial?.id} version={initial?.updatedAt}>
      <Section title="Price change" description="One material's purchase price, before and after.">
        <div className="grid gap-4 md:grid-cols-2">
          <ComboboxField control={control} name="inputs.itemId" label="Material" required options={items} placeholder="Pick a material" description={itemPriceHint(item)} />
          <SelectField control={control} name="inputs.currentBasis" label="Current price" options={priceBasisOptions} />
          <SelectField control={control} name="inputs.mode" label="Change as" options={MODES} />
          {mode === "price" ? (
            <NumberField control={control} name="inputs.revisedPrice" label={`Revised price${item ? ` a ${item.unit}` : ""}`} currency />
          ) : (
            <NumberField control={control} name="inputs.percent" label="Expected change" suffix="%" allowNegative step="any" description="Use a minus sign for a fall in price." />
          )}
          <NumberField control={control} name="inputs.expectedQty" label="Expected quantity to buy" suffix={item?.unit} />
          <MultiComboboxField control={control} name="inputs.projectIds" label="Affected projects" options={projects} placeholder="Optional" description="The difference is shared across them by what each used of the material." />
        </div>
      </Section>
    </ScenarioFormShell>
  );
}
