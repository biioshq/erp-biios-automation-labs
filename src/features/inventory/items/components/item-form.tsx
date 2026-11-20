"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Boxes, NotebookText, PackagePlus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { applyFieldErrors } from "@/lib/action-result";
import { INVENTORY_UNITS, labelOf } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatMonth, round2 } from "@/lib/format";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { createItem, suggestCopyName, suggestSku, updateItem } from "../actions";
import { copyBaseName, copyName, copyNumber } from "../matching";
import { itemFormSchema, type ItemFormInput, type ItemFormValues } from "../schemas";
import { DEFAULT_PURCHASE_PAYMENT_METHOD, PURCHASE_PAYMENT_METHODS } from "../../ledger/schemas";
import type { ItemFormRecord } from "../types";
import { formValidation } from "@/components/forms/form-options";
import { SimilarItemsNotice, useSimilarItems } from "./similar-items-notice";

export type CategoryOption = { value: string; label: string; color: string };

/**
 * A new item started from an existing one (Duplicate): its descriptive details only. Stock, prices,
 * purchase date and history stay with the original, and the SKU is suggested fresh.
 */
function defaultsFromTemplate(template: ItemFormRecord, categories: CategoryOption[]): ItemFormInput {
  const categoryId = template.categoryId && categories.some((c) => c.value === template.categoryId) ? template.categoryId : undefined;
  return {
    // Replaced after mount by the first free "(copy N)" name when this one is taken.
    // A copy of a copy starts one number up, so the form never opens on the source's own name.
    name: copyName(copyBaseName(template.name), copyNumber(template.name) + 1),
    sku: "",
    categoryId,
    unit: template.unit ?? "pcs",
    minStock: template.minStock || undefined,
    vendor: template.vendor ?? "",
    purchaseDate: undefined,
    description: template.description ?? "",
    location: template.location ?? "",
    openingQuantity: undefined,
    openingUnitPrice: undefined,
    // Left unset so the switch follows the purchase date until it is changed (see openingIsPurchase).
    openingAsPurchase: undefined,
    openingPaymentMethod: DEFAULT_PURCHASE_PAYMENT_METHOD,
  };
}

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
    // Left unset so the switch follows the purchase date until it is changed (see openingIsPurchase).
    openingAsPurchase: undefined,
    openingPaymentMethod: DEFAULT_PURCHASE_PAYMENT_METHOD,
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
 * `template` starts a new item from an existing one; it is never saved over.
 */
export function ItemForm({
  item,
  template,
  categories,
  vendors,
  defaultCategoryId,
  onDone,
  onCancel,
}: {
  item?: ItemFormRecord | null;
  template?: ItemFormRecord | null;
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
  // What the form was filled with, fixed at mount: the item prop can refresh while the form stays
  // open, and the server compares against these to leave a purchase made meanwhile in place.
  const [loaded] = useState(() => ({ vendor: item?.vendor ?? null, purchaseDate: item?.purchaseDate ?? null }));

  const form = useForm<ItemFormInput, unknown, ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: !item && template ? defaultsFromTemplate(template, categories) : defaultsFrom(item, defaultCategoryId),
    ...formValidation,
  });
  const { control, setValue, getValues } = form;
  const unit = useWatch({ control, name: "unit" });
  const typedName = useWatch({ control, name: "name" });
  const typedSku = useWatch({ control, name: "sku" });
  // Adding only: an item being edited is already the one in inventory.
  const similar = useSimilarItems(typedName, typedSku, !isEdit);
  const openingQuantity = useWatch({ control, name: "openingQuantity" });
  const openingUnitPrice = useWatch({ control, name: "openingUnitPrice" });
  const purchaseDate = useWatch({ control, name: "purchaseDate" });
  // Stock with a purchase date in an earlier month is most likely stock already on hand: booking it as
  // a purchase would change a past month's totals, so the switch starts off then. A choice made with
  // the switch is kept when the date changes.
  const pastMonth = Boolean(purchaseDate) && String(purchaseDate).slice(0, 7) < toDateInput(new Date()).slice(0, 7);
  const openingIsPurchase = (value: boolean | undefined) => value ?? !pastMonth;
  const openingAsPurchase = openingIsPurchase(useWatch({ control, name: "openingAsPurchase" }));
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

  // Duplicate: select "<name> (copy)" for retyping and propose a SKU of its own. The SKU is built
  // from the original name (the suffix " (copy)" would add a COP part) and made unique by suggestSku.
  // When "<name> (copy)" is already an item, the name moves on to the first free "(copy N)".
  const templateId = !item && template ? template.id : null;
  useEffect(() => {
    if (!templateId || !template) return;
    const frame = window.requestAnimationFrame(() => form.setFocus("name", { shouldSelect: true }));
    let cancelled = false;
    let reselect = 0;
    const startName = getValues("name");
    void suggestCopyName({ name: template.name }).then((result) => {
      // Never over a name the user has started to change.
      if (cancelled || !result.ok || result.data.name === startName || getValues("name") !== startName) return;
      const input = document.activeElement;
      const wasSelected = input instanceof HTMLInputElement && input.name === "name";
      setValue("name", result.data.name, { shouldValidate: true, shouldDirty: true });
      // Select once the new value is on screen (selecting before React writes it would be lost).
      if (wasSelected) reselect = window.requestAnimationFrame(() => form.setFocus("name", { shouldSelect: true }));
    });
    void suggestSku({ name: template.name, categoryId: getValues("categoryId") }).then((result) => {
      // Never over a SKU the user typed meanwhile.
      if (cancelled || !result.ok || getValues("sku")) return;
      setValue("sku", result.data.sku, { shouldValidate: true, shouldDirty: true });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(reselect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload = isEdit
        ? { ...values, openingQuantity: undefined, openingUnitPrice: undefined, openingAsPurchase: undefined, openingPaymentMethod: undefined }
        : { ...values, openingAsPurchase: openingIsPurchase(values.openingAsPurchase) };
      const result = isEdit && item ? await updateItem({ ...payload, id: item.id, loaded }) : await createItem(payload);
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
          <SimilarItemsNotice matches={similar} />
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
            {(openingQuantity ?? 0) > 0 ? (
              <>
                <Controller
                  control={control}
                  name="openingAsPurchase"
                  render={({ field }) => (
                    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-surface/40 px-3.5 py-3">
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-sm font-medium">Bought now, add to expenses</span>
                        <span className="block text-xs text-pretty text-muted-foreground">
                          {openingIsPurchase(field.value)
                            ? "Adds this stock to expenses as a purchase, on the purchase date (today if none). Assigning it to a project later does not add it again."
                            : "Stock you already had: no expense now. Its cost is added to expenses when it is assigned to a project."}
                        </span>
                      </span>
                      <Switch checked={openingIsPurchase(field.value)} onCheckedChange={field.onChange} className="mt-0.5" />
                    </label>
                  )}
                />
                {openingAsPurchase && pastMonth && purchaseDate ? (
                  <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    {openingUnitPrice !== undefined
                      ? `This adds ${formatCurrency(round2((openingQuantity ?? 0) * openingUnitPrice))} to expenses in ${formatMonth(fromDateInput(String(purchaseDate)))}, a past month.`
                      : `This adds the stock's cost to expenses in ${formatMonth(fromDateInput(String(purchaseDate)))}, a past month.`}{" "}
                    Turn this off for stock you already had.
                  </p>
                ) : null}
                {openingAsPurchase ? (
                  <SelectField control={control} name="openingPaymentMethod" label="Payment method" options={PURCHASE_PAYMENT_METHODS} />
                ) : null}
              </>
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
