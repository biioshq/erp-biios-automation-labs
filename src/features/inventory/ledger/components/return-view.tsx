"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowDownToLine, Boxes, Undo2 } from "lucide-react";
import { DateField, NumberField, TextareaField } from "@/components/forms/fields";
import { useOnLiveChange } from "@/components/live-updates";
import { Money } from "@/components/shared/money";
import { StockStatusBadge } from "@/components/shared/status-badge";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import { fetchHeldItems, fetchProjectImpact, returnStockAction } from "../actions";
import { returnFormSchema, type ReturnFormInput, type ReturnFormValues } from "../schemas";
import type { HeldItem, LedgerItem, LedgerProject, ProjectImpact } from "../types";
import { ItemCard } from "./item-card";
import { ContextPlaceholder, ImpactRow, OperationForm, OperationLayout, SubmitBar } from "./operation-layout";
import { PickerField, type PickerOption } from "./picker-field";
import { formValidation } from "@/components/forms/form-options";

const FORM_ID = "return-stock-form";

function defaultsFor(projectId?: string, itemId?: string): ReturnFormInput {
  return {
    projectId: projectId as string,
    itemId: itemId as string,
    quantity: undefined as unknown as number,
    date: toDateInput(new Date()),
    note: "",
  };
}

const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Credit for returning `quantity`: the latest assignments are reduced first, each at its own cost.
 * Mirrors returnStock on the server: each lot is credited what its expense drops by (rounded
 * before minus rounded after), so the preview matches the amount booked to the paisa. */
export function creditFor(held: HeldItem, quantity: number) {
  let remaining = roundQty(quantity);
  let credit = 0;
  for (const lot of held.lots) {
    if (remaining <= 1e-9) break;
    // Wasted units cannot come back, but they stay in the expense, so the credit is still worked
    // out on the lot's full quantity.
    const take = roundQty(Math.min(remaining, lot.returnable));
    if (take <= 0) continue;
    remaining = roundQty(remaining - take);
    credit += round2(lot.quantity * lot.unitCost) - round2(roundQty(lot.quantity - take) * lot.unitCost);
  }
  return round2(credit);
}

type Loaded = { projectId: string; held: HeldItem[]; impact: ProjectImpact | null };

export function ReturnView({
  items,
  projects,
  defaultProjectId,
  defaultItemId,
  recent,
}: {
  items: LedgerItem[];
  projects: LedgerProject[];
  defaultProjectId?: string;
  defaultItemId?: string;
  recent: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const initialProject = projects.find((p) => p.id === defaultProjectId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  const [heldForSchema, setHeldForSchema] = useState<HeldItem[]>([]);
  // A return is capped at what the project holds; the server enforces the same limit.
  const schema = useMemo(
    () =>
      returnFormSchema.superRefine((v, ctx) => {
        const h = heldForSchema.find((x) => x.itemId === v.itemId);
        if (h && v.quantity > h.held) {
          ctx.addIssue({ code: "custom", path: ["quantity"], message: `At most ${formatNumber(h.held)} ${h.unit} can be returned` });
        }
      }),
    [heldForSchema],
  );

  const form = useForm<ReturnFormInput, unknown, ReturnFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(initialProject?.id, defaultItemId),
    ...formValidation,
  });
  const { control, setValue } = form;

  const projectId = useWatch({ control, name: "projectId" });
  const itemId = useWatch({ control, name: "itemId" });
  const qty = useWatch({ control, name: "quantity" });

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    Promise.all([fetchHeldItems(projectId), fetchProjectImpact(projectId)]).then(([held, impact]) => {
      if (cancelled) return;
      setLoaded({ projectId, held, impact });
      setHeldForSchema(held);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, version]);
  // Someone else's assign or return changes what the project holds and its budget: reload the
  // preview (the form itself is not reset, so typing is kept). Also fires after this tab's own save.
  useOnLiveChange(() => setVersion((v) => v + 1));

  const held = useMemo(() => (loaded && loaded.projectId === projectId ? loaded.held : []), [loaded, projectId]);
  const loading = Boolean(projectId) && !(loaded && loaded.projectId === projectId);
  const impact = loaded && loaded.projectId === projectId ? loaded.impact : null;
  const heldItem = held.find((h) => h.itemId === itemId);
  const item = items.find((i) => i.id === itemId);
  const project = projects.find((p) => p.id === projectId);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const overQuantity = Boolean(heldItem && quantity > heldItem.held);

  // The item list belongs to the project: drop a selection the project does not hold.
  useEffect(() => {
    if (!loading && itemId && !held.some((h) => h.itemId === itemId)) setValue("itemId", undefined as unknown as string);
  }, [loading, held, itemId, setValue]);

  const itemOptions = useMemo<PickerOption[]>(
    () =>
      held.map((h) => ({
        value: h.itemId,
        label: h.name,
        description: `${h.sku} · holds ${formatNumber(h.held)} ${h.unit} · ${formatCurrency(h.cost)}`,
      })),
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

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await returnStockAction(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const r = result.data;
      toast.success(
        `Returned ${formatNumber(r.quantity)} ${r.unit} of ${r.itemName} from ${r.projectName}. ${formatCurrency(r.credited)} credited to the project. Available is now ${formatNumber(r.available)}.`,
      );
      emitDataChanged();
      form.reset({ ...defaultsFor(values.projectId), itemId: "" });
    });
  });

  const credit = heldItem && quantity > 0 && !overQuantity ? creditFor(heldItem, quantity) : 0;
  const heldValue = round2(held.reduce((sum, h) => sum + h.cost, 0));

  const submitBar = (className: string) => (
    <SubmitBar
      className={className}
      formId={FORM_ID}
      pending={pending}
      disabled={overQuantity}
      label="Return to stock"
      icon={<Undo2 />}
      note={
        credit > 0 ? (
          <>
            Credits <Money value={credit} className="font-medium text-foreground" /> to {project?.name}
          </>
        ) : (
          "The project's expense is reduced when you save."
        )
      }
    />
  );

  return (
    <OperationLayout
      recent={recent}
      form={
        <OperationForm id={FORM_ID} onSubmit={onSubmit}>
          <PickerField
            control={control}
            name="projectId"
            label="Project"
            required
            options={projectOptions}
            placeholder="Choose the project returning stock"
            searchPlaceholder="Search projects…"
          />

          <PickerField
            control={control}
            name="itemId"
            label="Item"
            required
            disabled={!projectId || loading}
            options={itemOptions}
            placeholder={!projectId ? "Pick a project first" : loading ? "Loading what the project holds…" : held.length ? "Choose an item to return" : "This project holds no stock"}
            searchPlaceholder="Search items held…"
            emptyText="The project holds nothing like that."
            description={projectId && !loading && held.length === 0 ? "Stock assigned to this project shows up here until it is returned." : undefined}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={control}
              name="quantity"
              label="Quantity"
              required
              disabled={!heldItem}
              suffix={heldItem?.unit}
              description={
                heldItem ? (
                  <span className={overQuantity ? "text-danger" : undefined}>
                    {overQuantity ? `At most ${formatNumber(heldItem.held)} ${heldItem.unit} can be returned` : `The project holds ${formatNumber(heldItem.held)} ${heldItem.unit}`}
                  </span>
                ) : undefined
              }
            />
            <DateField control={control} name="date" label="Return date" required />
          </div>

          <TextareaField control={control} name="note" label="Note" rows={2} placeholder="Condition, reason for the return (optional)" />

          <div className="hidden border-t pt-5 lg:block">{submitBar("")}</div>
        </OperationForm>
      }
      submit={submitBar("lg:hidden")}
      context={
        project ? (
          <>
            <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
              <p className="eyebrow">Project holds</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: project.color }} />
                <h3 className="truncate text-base font-semibold tracking-tight">{project.name}</h3>
              </div>
              {loading ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
              ) : held.length === 0 ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Boxes className="size-4" /> No stock is assigned to this project right now.
                </p>
              ) : (
                <>
                  <p className="tabular mt-3 text-sm text-muted-foreground">
                    {held.length} {held.length === 1 ? "item" : "items"} worth <Money value={heldValue} className="font-medium text-foreground" /> at assignment cost
                  </p>
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
                  {held.length > 6 ? <p className="mt-1 text-xs text-muted-foreground">and {held.length - 6} more</p> : null}
                </>
              )}
            </section>

            {item && heldItem ? (
              <>
                <ItemCard item={item} title="Stock room" />
                {credit > 0 ? (
                  <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
                    <p className="eyebrow flex items-center gap-1.5">
                      <ArrowDownToLine className="size-3.5" /> Effect of this return
                    </p>
                    <div className="mt-2 divide-y">
                      <ImpactRow label="Available" before={item.available} after={item.available + quantity} format={(n) => `${formatNumber(n)} ${item.unit}`} tone="good" />
                      <ImpactRow label="In use on projects" before={item.allocated} after={item.allocated - quantity} format={(n) => `${formatNumber(n)} ${item.unit}`} />
                      {impact ? (
                        <ImpactRow label={`${project.name} spend`} before={impact.spent} after={round2(impact.spent - credit)} format={(n) => <Money value={n} />} tone="good" />
                      ) : null}
                      {impact && impact.budget > 0 ? (
                        <ImpactRow label="Budget remaining" before={round2(impact.budget - impact.spent)} after={round2(impact.budget - impact.spent + credit)} format={(n) => <Money value={n} />} />
                      ) : null}
                      {impact?.salariesHidden ? (
                        <p className="py-2 text-xs text-muted-foreground">Spend excludes salaries, which only admins can see.</p>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center justify-between border-t pt-3 text-sm">
                      <span className="text-muted-foreground">Credit to project</span>
                      <Money value={credit} className="font-semibold text-success" />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Stock status after</span>
                      <StockStatusBadge status={getStockStatus(item.available + quantity, item.minStock)} />
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">Latest assignments are reduced first, each at the cost it was assigned at.</p>
                  </section>
                ) : (
                  <ContextPlaceholder title="Enter a quantity">The credit to the project and the new stock levels show up here.</ContextPlaceholder>
                )}
              </>
            ) : (
              <ContextPlaceholder title="Pick an item to return">Its stock levels and the credit to the project show up here.</ContextPlaceholder>
            )}
          </>
        ) : (
          <ContextPlaceholder title="Pick a project">The stock it currently holds and the effect of a return show up here.</ContextPlaceholder>
        )
      }
    />
  );
}
