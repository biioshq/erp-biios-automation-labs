"use client";

import { useId, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Boxes, NotebookText, PackagePlus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { applyFieldErrors } from "@/lib/action-result";
import { INVENTORY_UNITS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import { createItem, suggestSku, updateItem } from "../actions";
import { itemFormSchema, type ItemFormInput, type ItemFormValues } from "../schemas";
import type { ItemFormRecord } from "../types";

export type CategoryOption = { value: string; label: string; color: string };

function defaultsFrom(item?: ItemFormRecord | null, categoryId?: string): ItemFormInput {
  return {
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    categoryId: item?.categoryId ?? categoryId ?? undefined,
    unit: item?.unit ?? "pcs",
    minStock: item?.minStock ?? undefined,
    vendor: item?.vendor ?? "",
    purchaseDate: item?.purchaseDate ?? undefined,
    description: item?.description ?? "",
    location: item?.location ?? "",
    openingQuantity: undefined,
    openingUnitPrice: undefined,
  };
}

/** Text input with browser suggestions from known vendor names. */
function VendorField({ control, vendors }: { control: ReturnType<typeof useForm<ItemFormInput, unknown, ItemFormValues>>["control"]; vendors: string[] }) {
  const listId = useId();
  return (
    <Controller
      control={control}
      name="vendor"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
          <FieldLabel htmlFor="vendor" className="text-[13px]">
            Vendor
          </FieldLabel>
          <Input
            {...field}
            id="vendor"
            value={(field.value as string | undefined) ?? ""}
            list={listId}
            autoComplete="off"
            placeholder="Who you buy it from"
            aria-invalid={fieldState.invalid}
          />
          <datalist id={listId}>
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
        </Field>
      )}
    />
  );
}

/**
 * Create or edit an item. Editing never touches quantities: stock changes go
 * through Purchase, Assign, Return or Adjust so every change has a movement.
 */
export function ItemForm({
  item,
  categories,
  vendors,
  defaultCategoryId,
  onDone,
  onCancel,
}: {
  item?: ItemFormRecord | null;
  categories: CategoryOption[];
  vendors: string[];
  defaultCategoryId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(item);
  const [pending, startTransition] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const [skuTouched, setSkuTouched] = useState(isEdit);

  const form = useForm<ItemFormInput, unknown, ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: defaultsFrom(item, defaultCategoryId),
    mode: "onTouched",
  });
  const { control, setValue, getValues } = form;
  const unit = useWatch({ control, name: "unit" });
  const openingQuantity = useWatch({ control, name: "openingQuantity" });
  const openingUnitPrice = useWatch({ control, name: "openingUnitPrice" });
  const unitLabel = labelOf(INVENTORY_UNITS, unit).toLowerCase();

  async function suggest(auto = false) {
    const name = getValues("name")?.trim();
    if (!name) {
      if (!auto) toast.info("Enter the item name first.");
      return;
    }
    setSuggesting(true);
    const result = await suggestSku({ name, categoryId: getValues("categoryId") });
    setSuggesting(false);
    if (result.ok) setValue("sku", result.data.sku, { shouldValidate: true, shouldDirty: true });
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload = isEdit ? { ...values, openingQuantity: undefined, openingUnitPrice: undefined } : values;
      const result = isEdit && item ? await updateItem({ ...payload, id: item.id }) : await createItem(payload);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? (isEdit ? "Item updated" : "Item added"));
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <FormSection title="Item" icon={<Boxes />} description="What it is and how it is identified.">
          <TextField
            control={control}
            name="name"
            label="Item name"
            required
            autoFocus
            placeholder="Steel rods, 12 mm"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={control}
              name="categoryId"
              label="Category"
              placeholder={categories.length ? "Pick a category" : "No categories yet"}
              options={categories.map((c) => ({
                value: c.value,
                label: c.label,
                icon: <span className="size-2 rounded-full" style={{ background: c.color }} />,
              }))}
              clearable
              description={categories.length ? undefined : "Add categories from the Categories page."}
            />
            <SelectField
              control={control}
              name="unit"
              label="Unit"
              required
              options={INVENTORY_UNITS.map((u) => ({ value: u.value, label: u.label }))}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-end gap-2">
              <TextField
                control={control}
                name="sku"
                label="SKU"
                required
                mono
                placeholder="STL-ROD-012"
                className="flex-1"
                transform={(v) => {
                  setSkuTouched(true);
                  return v.toUpperCase();
                }}
                description="Unique. Used on purchase invoices and reports."
              />
              <Button type="button" variant="outline" onClick={() => suggest()} disabled={suggesting} className="mb-[1px] shrink-0">
                {suggesting ? <Spinner /> : <Wand2 />} Suggest
              </Button>
            </div>
            {!skuTouched && !isEdit ? (
              <p className="text-xs text-muted-foreground">Tip: Suggest builds a SKU from the name and category.</p>
            ) : null}
          </div>
        </FormSection>

        <FormSection title="Stock rules" icon={<NotebookText />} description="The minimum decides when this item shows as Low Stock.">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={control}
              name="minStock"
              label="Minimum stock"
              suffix={unitLabel}
              placeholder="0"
              description="Low Stock when available is at or below this."
            />
            <TextField control={control} name="location" label="Storage location" placeholder="Rack B, shelf 3" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <VendorField control={control} vendors={vendors} />
            <DateField control={control} name="purchaseDate" label="Purchase date" clearable />
          </div>
          <TextareaField control={control} name="description" label="Description" rows={3} placeholder="Grade, size, finish, supplier notes" />
        </FormSection>

        {isEdit ? (
          <p className="rounded-lg border bg-surface/40 px-3.5 py-3 text-xs text-muted-foreground">
            Quantities are not edited here. Use Purchase stock, Assign, Return or Adjust stock so the history stays complete.
          </p>
        ) : (
          <FormSection
            title="Opening stock"
            icon={<PackagePlus />}
            description="Optional. Recorded as the first purchase, so the item history starts with a real movement."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField control={control} name="openingQuantity" label="Quantity on hand" suffix={unitLabel} placeholder="0" />
              <NumberField control={control} name="openingUnitPrice" label="Unit price" currency />
            </div>
            {(openingQuantity ?? 0) > 0 && openingUnitPrice !== undefined ? (
              <FieldDescription className="text-xs">
                Opening value <Money value={round2((openingQuantity ?? 0) * openingUnitPrice)} className="font-medium text-foreground" />
              </FieldDescription>
            ) : null}
          </FormSection>
        )}
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Add item"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
