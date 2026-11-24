"use client";

import { useId, useMemo, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { MapPin, MoveRight } from "lucide-react";
import { DateField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { ContextPlaceholder, OperationForm, OperationLayout, SubmitBar } from "../../ledger/components/operation-layout";
import { PickerField, type PickerOption } from "../../ledger/components/picker-field";
import { relocateItemAction } from "../actions";
import { relocationSchema, type RelocationInput, type RelocationValues } from "../schemas";
import type { LocatedItem } from "../types";

const FORM_ID = "relocate-item-form";

const defaultsFor = (itemId?: string): RelocationInput => ({ itemId: itemId as string, to: "", date: toDateInput(new Date()), note: "" });

/** Move an item to another storage location. Only where it is kept changes. */
export function RelocationForm({
  items,
  locations,
  defaultItemId,
  recent,
}: {
  items: LocatedItem[];
  locations: string[];
  defaultItemId?: string;
  recent: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const form = useForm<RelocationInput, unknown, RelocationValues>({
    resolver: zodResolver(relocationSchema),
    defaultValues: defaultsFor(defaultItemId),
    ...formValidation,
  });
  const { control } = form;
  const itemId = useWatch({ control, name: "itemId" });
  const to = useWatch({ control, name: "to" });
  const item = items.find((i) => i.id === itemId);
  const target = to?.replace(/\s+/g, " ").trim() ?? "";
  const same = Boolean(item && target && (item.location ?? "").toLowerCase() === target.toLowerCase());

  const itemOptions = useMemo<PickerOption[]>(
    () =>
      items.map((i) => ({
        value: i.id,
        label: i.name,
        description: [i.sku, i.variant, i.location ? `at ${i.location}` : "no location set"].filter(Boolean).join(" · "),
        leading: <MapPin className="size-3.5 shrink-0 text-muted-foreground" />,
      })),
    [items],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await relocateItemAction(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const r = result.data;
      toast.success(`${r.itemName} is now kept at ${r.to}${r.from ? `, moved from ${r.from}` : ""}.`);
      emitDataChanged();
      form.reset(defaultsFor());
    });
  });

  const submitBar = (className: string) => (
    <SubmitBar
      className={className}
      formId={FORM_ID}
      pending={pending}
      disabled={same}
      label="Move item"
      icon={<MoveRight />}
      note="Stock levels and value do not change. The move is kept in the item's history."
    />
  );

  return (
    <OperationLayout
      recent={recent}
      form={
        <OperationForm id={FORM_ID} onSubmit={onSubmit}>
          <PickerField
            control={control}
            name="itemId"
            label="Item"
            required
            options={itemOptions}
            placeholder="Choose the item to move"
            searchPlaceholder="Search items…"
            emptyText="No item like that."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="to"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || same || undefined} className="gap-1.5">
                  <FieldLabel htmlFor="relocation-to" className="text-[13px]">
                    <span>New location<span className="ml-0.5 text-danger">*</span></span>
                  </FieldLabel>
                  <Input
                    {...field}
                    id="relocation-to"
                    value={field.value ?? ""}
                    list={listId}
                    autoComplete="off"
                    placeholder="Rack B, shelf 3"
                    aria-invalid={fieldState.invalid || same}
                  />
                  <datalist id={listId}>
                    {locations.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                  {same ? (
                    <FieldDescription className="text-xs text-danger">The item is already kept there.</FieldDescription>
                  ) : !fieldState.error ? (
                    <FieldDescription className="text-xs">Pick a known place or type a new one.</FieldDescription>
                  ) : null}
                  <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
                </Field>
              )}
            />
            <DateField control={control} name="date" label="Date" required />
          </div>
          <TextareaField control={control} name="note" label="Note" rows={2} placeholder="Why it moved (optional)" />
          <div className="hidden border-t pt-5 lg:block">{submitBar("")}</div>
        </OperationForm>
      }
      submit={submitBar("lg:hidden")}
      context={
        item ? (
          <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
            <p className="eyebrow flex items-center gap-1.5">
              <MapPin className="size-3.5" /> Location
            </p>
            <h3 className="mt-2 truncate text-base font-semibold tracking-tight">{item.name}</h3>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{item.sku}</p>
            <dl className="mt-3 divide-y text-sm">
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Kept at now</dt>
                <dd className="truncate font-medium">{item.location ?? "Not set"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted-foreground">After the move</dt>
                <dd className="truncate font-semibold">{target || "-"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Units moved</dt>
                <dd className="tabular font-medium">
                  {formatNumber(item.available)} {item.unit}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">All of the item&apos;s stock in storage moves. Units in use on projects stay where they are.</p>
          </section>
        ) : (
          <ContextPlaceholder title="Pick an item">Where it is kept now and where it goes show up here.</ContextPlaceholder>
        )
      }
    />
  );
}
