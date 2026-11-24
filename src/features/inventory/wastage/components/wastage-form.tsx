"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Boxes, FolderKanban, Trash2, Warehouse } from "lucide-react";
import { DateField, NumberField, SelectField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { useOnLiveChange } from "@/components/live-updates";
import { Money } from "@/components/shared/money";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { applyFieldErrors } from "@/lib/action-result";
import { DEPARTMENTS, WASTAGE_REASONS } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import { fetchHeldItems } from "../../ledger/actions";
import { ItemCard, StatusDot } from "../../ledger/components/item-card";
import { ContextPlaceholder, ImpactRow, OperationForm, OperationLayout, SubmitBar } from "../../ledger/components/operation-layout";
import { PickerField, type PickerOption } from "../../ledger/components/picker-field";
import { splitRemoval } from "../../ledger/stock-cost";
import type { HeldItem, LedgerItem, LedgerProject } from "../../ledger/types";
import { recordWastageAction } from "../actions";
import { WASTAGE_SOURCES, wastageFormSchema, type WastageFormInput, type WastageFormValues } from "../schemas";

const FORM_ID = "record-wastage-form";
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

function defaultsFor(from: WastageFormInput["from"], itemId?: string, projectId?: string): WastageFormInput {
  return {
    from,
    projectId,
    itemId: itemId as string,
    quantity: undefined as unknown as number,
    reason: undefined as unknown as WastageFormInput["reason"],
    department: undefined,
    location: "",
    responsible: "",
    date: toDateInput(new Date()),
    note: "",
  };
}

/** Value of `quantity` units wasted on a project: latest assignments first, each at its own cost (as the ledger books it). */
export function projectWasteValue(held: HeldItem, quantity: number) {
  let remaining = roundQty(quantity);
  let value = 0;
  for (const lot of held.lots) {
    if (remaining <= 1e-9) break;
    const take = roundQty(Math.min(remaining, lot.returnable));
    if (take <= 0) continue;
    remaining = roundQty(remaining - take);
    value += round2(take * lot.unitCost);
  }
  return round2(value);
}

/** Free text with browser suggestions (places stock is kept, people on the team). */
function SuggestInput({
  control,
  name,
  label,
  placeholder,
  suggestions,
  description,
}: {
  control: Control<WastageFormInput, unknown, WastageFormValues>;
  name: "location" | "responsible";
  label: string;
  placeholder: string;
  suggestions: string[];
  description?: string;
}) {
  const listId = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
          <FieldLabel htmlFor={name} className="text-[13px]">
            {label}
          </FieldLabel>
          <Input
            {...field}
            id={name}
            value={(field.value as string | undefined) ?? ""}
            list={listId}
            autoComplete="off"
            placeholder={placeholder}
            aria-invalid={fieldState.invalid}
          />
          <datalist id={listId}>
            {suggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {description && !fieldState.error ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
        </Field>
      )}
    />
  );
}

type Loaded = { projectId: string; held: HeldItem[] };

/** Record wastage: from the stock room, or of stock in use on a project. */
export function WastageForm({
  items,
  projects,
  locations,
  people,
  defaultItemId,
  defaultProjectId,
  recent,
}: {
  items: LedgerItem[];
  projects: LedgerProject[];
  locations: string[];
  people: string[];
  defaultItemId?: string;
  defaultProjectId?: string;
  recent: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const initialProject = projects.find((p) => p.id === defaultProjectId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  const [heldForSchema, setHeldForSchema] = useState<HeldItem[]>([]);

  // Capped at what is in storage, or at what the project still has in use; the server checks the same.
  const schema = useMemo(
    () =>
      wastageFormSchema.superRefine((v, ctx) => {
        if (v.from === "storage") {
          const it = items.find((i) => i.id === v.itemId);
          if (it && v.quantity > it.available) {
            ctx.addIssue({ code: "custom", path: ["quantity"], message: `Only ${formatNumber(it.available)} ${it.unit} in storage` });
          }
        } else {
          const h = heldForSchema.find((x) => x.itemId === v.itemId);
          if (h && v.quantity > h.held) {
            ctx.addIssue({ code: "custom", path: ["quantity"], message: `Only ${formatNumber(h.held)} ${h.unit} in use on this project` });
          }
        }
      }),
    [items, heldForSchema],
  );

  const form = useForm<WastageFormInput, unknown, WastageFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(initialProject ? "project" : "storage", defaultItemId, initialProject?.id),
    ...formValidation,
  });
  const { control, setValue } = form;
  const from = useWatch({ control, name: "from" });
  const projectId = useWatch({ control, name: "projectId" });
  const itemId = useWatch({ control, name: "itemId" });
  const qty = useWatch({ control, name: "quantity" });
  const onProject = from === "project";

  useEffect(() => {
    if (!onProject || !projectId) return;
    let cancelled = false;
    fetchHeldItems(projectId).then((held) => {
      if (cancelled) return;
      setLoaded({ projectId, held });
      setHeldForSchema(held);
    });
    return () => {
      cancelled = true;
    };
  }, [onProject, projectId, version]);
  // Someone else's assignment or return changes what the project holds: reload it.
  useOnLiveChange(() => setVersion((v) => v + 1));

  const held = useMemo(() => (loaded && loaded.projectId === projectId ? loaded.held : []), [loaded, projectId]);
  const loadingHeld = onProject && Boolean(projectId) && !(loaded && loaded.projectId === projectId);
  const heldItem = onProject ? held.find((h) => h.itemId === itemId) : undefined;
  const item = items.find((i) => i.id === itemId);
  const project = projects.find((p) => p.id === projectId);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const cap = onProject ? (heldItem?.held ?? 0) : (item?.available ?? 0);
  const overQuantity = quantity > cap && Boolean(onProject ? heldItem : item);

  // The item list depends on the source: drop a selection that is not in it.
  useEffect(() => {
    if (!itemId) return;
    if (onProject && !loadingHeld && projectId && !held.some((h) => h.itemId === itemId)) setValue("itemId", undefined as unknown as string);
  }, [onProject, loadingHeld, held, itemId, projectId, setValue]);

  const storageOptions = useMemo<PickerOption[]>(
    () =>
      items.map((i) => ({
        value: i.id,
        label: i.name,
        description: `${i.sku}${i.variant ? ` · ${i.variant}` : ""} · ${formatNumber(i.available)} ${i.unit} in storage`,
        disabled: i.available <= 0,
        leading: <StatusDot status={i.status} />,
      })),
    [items],
  );
  const heldOptions = useMemo<PickerOption[]>(
    () => held.map((h) => ({ value: h.itemId, label: h.name, description: `${h.sku} · ${formatNumber(h.held)} ${h.unit} in use` })),
    [held],
  );
  const projectOptions = useMemo<PickerOption[]>(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: p.name,
        description: p.description,
        leading: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects],
  );

  const storageSplit = !onProject && item && quantity > 0 && !overQuantity ? splitRemoval(item, quantity) : null;
  const storageValue = storageSplit ? (storageSplit.value ?? storageSplit.unexpensedOut) : 0;
  const storageExpense = storageSplit && storageSplit.fromUnexpensed > 0 ? storageSplit.unexpensedOut : 0;
  const projectValue = heldItem && quantity > 0 && !overQuantity ? projectWasteValue(heldItem, quantity) : 0;
  const value = onProject ? projectValue : storageValue;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await recordWastageAction(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const r = result.data;
      const where = r.from === "project" ? ` on ${r.projectName}` : "";
      const booked = r.expenseNumber
        ? ` ${formatCurrency(r.expenseAmount)} of it had never been expensed and is booked now as ${r.expenseNumber}.`
        : "";
      toast.success(`Wrote off ${formatNumber(r.quantity)} ${r.unit} of ${r.itemName}${where}, worth ${formatCurrency(r.value)}.${booked}`);
      emitDataChanged();
      form.reset({ ...defaultsFor(values.from, undefined, values.from === "project" ? values.projectId : undefined), itemId: "" });
    });
  });

  const submitBar = (className: string) => (
    <SubmitBar
      className={className}
      formId={FORM_ID}
      pending={pending}
      disabled={overQuantity}
      label="Record wastage"
      icon={<Trash2 />}
      note={
        value > 0 ? (
          <>
            Writes off <Money value={value} className="font-medium text-foreground" /> at cost
          </>
        ) : (
          "The write-off is valued at the cost the stock is on the books at."
        )
      }
    />
  );

  return (
    <OperationLayout
      recent={recent}
      form={
        <OperationForm id={FORM_ID} onSubmit={onSubmit}>
          <Controller
            control={control}
            name="from"
            render={({ field }) => (
              <Field className="gap-1.5">
                <FieldLabel className="text-[13px]">
                  Where was the stock<span className="ml-0.5 text-danger">*</span>
                </FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={0}
                  value={field.value}
                  onValueChange={(v) => {
                    if (!v) return;
                    field.onChange(v);
                    setValue("itemId", undefined as unknown as string);
                    setValue("quantity", undefined as unknown as number);
                  }}
                  className="w-full"
                  aria-label="Where was the stock"
                >
                  {WASTAGE_SOURCES.map((s) => (
                    <ToggleGroupItem key={s.value} value={s.value} className="flex-1 max-md:h-10">
                      {s.value === "storage" ? <Warehouse /> : <FolderKanban />}
                      {s.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription className="text-xs">
                  {onProject
                    ? "Stock issued to a project and wasted there. The project already bears its cost, so stock levels and expenses do not change."
                    : "Stock in the stock room. It leaves stock at the cost it is on the books at."}
                </FieldDescription>
              </Field>
            )}
          />

          {onProject ? (
            <PickerField
              control={control}
              name="projectId"
              label="Project"
              required
              options={projectOptions}
              placeholder="Choose the project the stock was in use on"
              searchPlaceholder="Search projects…"
            />
          ) : null}

          <PickerField
            control={control}
            name="itemId"
            label="Item"
            required
            disabled={onProject && (!projectId || loadingHeld)}
            options={onProject ? heldOptions : storageOptions}
            placeholder={
              !onProject
                ? "Choose the item that was wasted"
                : !projectId
                  ? "Pick a project first"
                  : loadingHeld
                    ? "Loading what the project has in use…"
                    : held.length
                      ? "Choose the item that was wasted"
                      : "This project has no stock in use"
            }
            searchPlaceholder="Search items…"
            emptyText="No item like that."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={control}
              name="quantity"
              label="Quantity wasted"
              required
              disabled={onProject ? !heldItem : !item}
              suffix={(onProject ? heldItem?.unit : item?.unit) ?? undefined}
              description={
                (onProject ? heldItem : item) ? (
                  <span className={overQuantity ? "text-danger" : undefined}>
                    {onProject ? `${formatNumber(cap)} in use on this project` : `${formatNumber(cap)} in storage`}
                  </span>
                ) : undefined
              }
            />
            <SelectField
              control={control}
              name="reason"
              label="Reason"
              required
              placeholder="Why it was wasted"
              options={WASTAGE_REASONS.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={control}
              name="department"
              label="Department responsible"
              placeholder="Optional"
              clearable
              options={DEPARTMENTS.map((d) => ({ value: d.value, label: d.label }))}
            />
            <SuggestInput control={control} name="responsible" label="Person responsible" placeholder="Optional" suggestions={people} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SuggestInput
              control={control}
              name="location"
              label="Location"
              placeholder={onProject ? "Site or area" : (item?.location ?? "Rack, room or site")}
              suggestions={locations}
              description="Where it happened. Optional."
            />
            <DateField control={control} name="date" label="Date" required />
          </div>

          <TextareaField control={control} name="note" label="Note" rows={2} placeholder="What happened (optional)" />

          <div className="hidden border-t pt-5 lg:block">{submitBar("")}</div>
        </OperationForm>
      }
      submit={submitBar("lg:hidden")}
      context={
        onProject ? (
          project ? (
            <>
              <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
                <p className="eyebrow">In use on the project</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: project.color }} />
                  <h3 className="truncate text-base font-semibold tracking-tight">{project.name}</h3>
                </div>
                {loadingHeld ? (
                  <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
                ) : held.length === 0 ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Boxes className="size-4" /> No stock is in use on this project.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y text-sm">
                    {held.slice(0, 6).map((h) => (
                      <li key={h.itemId} className="flex items-center justify-between gap-3 py-2">
                        <span className="truncate">{h.name}</span>
                        <span className="tabular shrink-0 text-muted-foreground">
                          {formatNumber(h.held)} {h.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {heldItem && projectValue > 0 ? (
                <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
                  <p className="eyebrow flex items-center gap-1.5">
                    <Trash2 className="size-3.5" /> Effect of this write-off
                  </p>
                  <div className="mt-2 divide-y">
                    <ImpactRow label="In use, can be returned" before={heldItem.held} after={roundQty(heldItem.held - quantity)} format={(n) => `${formatNumber(n)} ${heldItem.unit}`} tone="bad" />
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t pt-3 text-sm">
                    <span className="text-muted-foreground">Value wasted</span>
                    <Money value={projectValue} className="font-semibold text-danger" />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Latest assignments first, at the cost each was charged at. The project&apos;s spend stays the same: it already paid for this stock.
                  </p>
                </section>
              ) : (
                <ContextPlaceholder title="Pick an item and a quantity">The value wasted shows up here.</ContextPlaceholder>
              )}
            </>
          ) : (
            <ContextPlaceholder title="Pick a project">The stock it has in use and the value of the write-off show up here.</ContextPlaceholder>
          )
        ) : item ? (
          <>
            <ItemCard item={item} title="Stock room" />
            {storageSplit ? (
              <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
                <p className="eyebrow flex items-center gap-1.5">
                  <Trash2 className="size-3.5" /> Effect of this write-off
                </p>
                <div className="mt-2 divide-y">
                  <ImpactRow label="Available" before={item.available} after={roundQty(item.available - quantity)} format={(n) => `${formatNumber(n)} ${item.unit}`} tone="bad" />
                  <ImpactRow label="Stock value" before={round2(item.available * item.unitPrice)} after={round2(Math.max(0, item.available * item.unitPrice - storageValue))} format={(n) => <Money value={n} />} />
                </div>
                <div className="mt-1 flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Value written off</span>
                  <Money value={storageValue} className="font-semibold text-danger" />
                </div>
                {storageExpense > 0 ? (
                  <p className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Booked now as a company expense</span>
                    <Money value={storageExpense} className="font-medium" />
                  </p>
                ) : null}
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Stock status after</span>
                  <StockStatusBadge status={getStockStatus(roundQty(item.available - quantity), item.minStock)} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {storageExpense > 0
                    ? "Part of this stock was never expensed (old or opening stock), so its cost is booked as an expense now. Stock bought since purchases became expenses books nothing more."
                    : "This stock was expensed when it was bought, so no new expense is booked."}
                </p>
              </section>
            ) : (
              <ContextPlaceholder title="Enter a quantity">The value written off and the new stock level show up here.</ContextPlaceholder>
            )}
          </>
        ) : (
          <ContextPlaceholder title="Pick an item">Its stock level and the value of the write-off show up here.</ContextPlaceholder>
        )
      }
    />
  );
}
