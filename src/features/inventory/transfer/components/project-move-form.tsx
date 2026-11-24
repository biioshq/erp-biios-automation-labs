"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeftRight, Boxes } from "lucide-react";
import { DateField, NumberField, SelectField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { useOnLiveChange } from "@/components/live-updates";
import { Money } from "@/components/shared/money";
import { applyFieldErrors } from "@/lib/action-result";
import { PROJECT_STAGES, labelOf } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { fetchHeldItems, fetchProjectImpact } from "../../ledger/actions";
import { creditFor } from "../../ledger/components/return-view";
import { ContextPlaceholder, ImpactRow, OperationForm, OperationLayout, SubmitBar } from "../../ledger/components/operation-layout";
import { PickerField, type PickerOption } from "../../ledger/components/picker-field";
import type { HeldItem, LedgerProject, ProjectImpact } from "../../ledger/types";
import { moveStockAction } from "../actions";
import { projectMoveSchema, type ProjectMoveInput, type ProjectMoveValues } from "../schemas";

const FORM_ID = "move-stock-form";

function defaultsFor(fromProjectId?: string, itemId?: string): ProjectMoveInput {
  return {
    fromProjectId: fromProjectId as string,
    itemId: itemId as string,
    toProjectId: undefined as unknown as string,
    stage: undefined as unknown as ProjectMoveInput["stage"],
    quantity: undefined as unknown as number,
    date: toDateInput(new Date()),
    note: "",
  };
}

const closed = (p: LedgerProject) => p.status === "cancelled" || p.status === "completed";

type Loaded = { projectId: string; held: HeldItem[] };
type Impact = { projectId: string; data: ProjectImpact | null };

const NONE: HeldItem[] = [];

/**
 * Hook: what a project holds (returnable units), reloaded when stock changes anywhere.
 * `onLoaded` hands the list to the form's quantity check.
 */
function useHeld(projectId: string | undefined, onLoaded: (held: HeldItem[]) => void) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchHeldItems(projectId).then((held) => {
      if (cancelled) return;
      setLoaded({ projectId, held });
      onLoaded(held);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, version, onLoaded]);
  useOnLiveChange(() => setVersion((v) => v + 1));
  const ready = Boolean(projectId) && loaded?.projectId === projectId;
  return { held: ready && loaded ? loaded.held : NONE, loading: Boolean(projectId) && !ready };
}

/** Hook: a project's budget and spend, for the before and after rows. */
function useImpact(projectId: string | undefined) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProjectImpact(projectId).then((data) => {
      if (!cancelled) setImpact({ projectId, data });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, version]);
  useOnLiveChange(() => setVersion((v) => v + 1));
  return impact && impact.projectId === projectId ? impact.data : null;
}

/** Move units one project holds to another project, at the cost they carry. */
export function ProjectMoveForm({
  projects,
  defaultFromProjectId,
  defaultItemId,
  recent,
}: {
  projects: LedgerProject[];
  defaultFromProjectId?: string;
  defaultItemId?: string;
  recent: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [heldForSchema, setHeldForSchema] = useState<HeldItem[]>([]);
  const initialFrom = projects.find((p) => p.id === defaultFromProjectId);

  // Capped at what the first project can still return; the server checks the same.
  const schema = useMemo(
    () =>
      projectMoveSchema.superRefine((v, ctx) => {
        const h = heldForSchema.find((x) => x.itemId === v.itemId);
        if (h && v.quantity > h.held) {
          ctx.addIssue({ code: "custom", path: ["quantity"], message: `At most ${formatNumber(h.held)} ${h.unit} can be moved` });
        }
      }),
    [heldForSchema],
  );

  const form = useForm<ProjectMoveInput, unknown, ProjectMoveValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(initialFrom?.id, defaultItemId),
    ...formValidation,
  });
  const { control, setValue } = form;
  const fromId = useWatch({ control, name: "fromProjectId" });
  const toId = useWatch({ control, name: "toProjectId" });
  const itemId = useWatch({ control, name: "itemId" });
  const stage = useWatch({ control, name: "stage" });
  const qty = useWatch({ control, name: "quantity" });

  const { held, loading } = useHeld(fromId, setHeldForSchema);
  const fromImpact = useImpact(fromId);
  const toImpact = useImpact(toId);

  const heldItem = held.find((h) => h.itemId === itemId);
  const source = projects.find((p) => p.id === fromId);
  const target = projects.find((p) => p.id === toId);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const overQuantity = Boolean(heldItem && quantity > heldItem.held);
  const value = heldItem && quantity > 0 && !overQuantity ? creditFor(heldItem, quantity) : 0;

  // The item list belongs to the first project: drop a selection it does not hold.
  useEffect(() => {
    if (!loading && itemId && fromId && !held.some((h) => h.itemId === itemId)) setValue("itemId", undefined as unknown as string);
  }, [loading, held, itemId, fromId, setValue]);

  const fromOptions = useMemo<PickerOption[]>(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: p.name,
        description: p.description,
        leading: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects],
  );
  const toOptions = useMemo<PickerOption[]>(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: p.name,
        description: closed(p) ? `${p.status === "completed" ? "Completed" : "Cancelled"}, cannot take stock` : p.id === fromId ? "The project the stock is on" : p.description,
        disabled: closed(p) || p.id === fromId,
        leading: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects, fromId],
  );
  const itemOptions = useMemo<PickerOption[]>(
    () => held.map((h) => ({ value: h.itemId, label: h.name, description: `${h.sku} · ${formatNumber(h.held)} ${h.unit} in use · ${formatCurrency(h.cost)}` })),
    [held],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await moveStockAction(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const r = result.data;
      toast.success(`Moved ${formatNumber(r.quantity)} ${r.unit} of ${r.itemName} from ${r.fromName} to ${r.toName}, with ${formatCurrency(r.value)} of cost.`);
      emitDataChanged();
      form.reset({ ...defaultsFor(values.fromProjectId), itemId: "", toProjectId: values.toProjectId, stage: values.stage });
    });
  });

  const submitBar = (className: string) => (
    <SubmitBar
      className={className}
      formId={FORM_ID}
      pending={pending}
      disabled={overQuantity}
      label="Move stock"
      icon={<ArrowLeftRight />}
      note={
        value > 0 && target ? (
          <>
            Moves <Money value={value} className="font-medium text-foreground" /> of cost to {target.name}
          </>
        ) : (
          "The cost moves with the units: one project is credited what the other is charged."
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
            name="fromProjectId"
            label="From project"
            required
            options={fromOptions}
            placeholder="Choose the project the stock is on"
            searchPlaceholder="Search projects…"
          />
          <PickerField
            control={control}
            name="itemId"
            label="Item"
            required
            disabled={!fromId || loading}
            options={itemOptions}
            placeholder={!fromId ? "Pick a project first" : loading ? "Loading what the project has in use…" : held.length ? "Choose an item to move" : "This project has no stock in use"}
            searchPlaceholder="Search items in use…"
            emptyText="The project has nothing like that in use."
            description={fromId && !loading && held.length === 0 ? "Units wasted on a project cannot be moved." : undefined}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField
              control={control}
              name="toProjectId"
              label="To project"
              required
              options={toOptions}
              placeholder="Choose where it goes"
              searchPlaceholder="Search projects…"
              description="Completed and cancelled projects cannot take stock."
            />
            <SelectField
              control={control}
              name="stage"
              label="Stage"
              required
              options={PROJECT_STAGES}
              placeholder="Choose a stage"
              description="The cost is booked under this stage of the new project."
            />
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
                    {overQuantity ? `At most ${formatNumber(heldItem.held)} ${heldItem.unit} can be moved` : `${formatNumber(heldItem.held)} ${heldItem.unit} in use on this project`}
                  </span>
                ) : undefined
              }
            />
            <DateField control={control} name="date" label="Date" required />
          </div>
          <TextareaField control={control} name="note" label="Note" rows={2} placeholder="Why it moved (optional)" />
          <div className="hidden border-t pt-5 lg:block">{submitBar("")}</div>
        </OperationForm>
      }
      submit={submitBar("lg:hidden")}
      context={
        source ? (
          <>
            <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
              <p className="eyebrow">In use on the project</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: source.color }} />
                <h3 className="truncate text-base font-semibold tracking-tight">{source.name}</h3>
              </div>
              {loading ? (
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
              {held.length > 6 ? <p className="mt-1 text-xs text-muted-foreground">and {held.length - 6} more</p> : null}
            </section>
            {heldItem && value > 0 ? (
              <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
                <p className="eyebrow flex items-center gap-1.5">
                  <ArrowLeftRight className="size-3.5" /> Effect of this move
                </p>
                <div className="mt-2 divide-y">
                  {fromImpact ? (
                    <ImpactRow label={`${source.name} spend`} before={fromImpact.spent} after={round2(fromImpact.spent - value)} format={(n) => <Money value={n} />} tone="good" />
                  ) : null}
                  {target && toImpact ? (
                    <ImpactRow
                      label={`${target.name} spend${stage ? ` (${labelOf(PROJECT_STAGES, stage)})` : ""}`}
                      before={toImpact.spent}
                      after={round2(toImpact.spent + value)}
                      format={(n) => <Money value={n} />}
                    />
                  ) : null}
                  {target && toImpact && toImpact.budget > 0 ? (
                    <ImpactRow
                      label={`${target.name} budget remaining`}
                      before={round2(toImpact.budget - toImpact.spent)}
                      after={round2(toImpact.budget - toImpact.spent - value)}
                      format={(n) => <Money value={n} />}
                      tone={toImpact.budget - toImpact.spent - value < 0 ? "bad" : undefined}
                    />
                  ) : null}
                  {fromImpact?.salariesHidden ? <p className="py-2 text-xs text-muted-foreground">Spend excludes salaries, which only admins can see.</p> : null}
                </div>
                <div className="mt-1 flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Cost moved</span>
                  <Money value={value} className="font-semibold" />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Latest assignments first, each at the cost it was assigned at. Stock levels in storage do not change, and company expenses stay the same.
                </p>
              </section>
            ) : (
              <ContextPlaceholder title="Pick an item, a project and a quantity">The cost moved and both projects&apos; spend show up here.</ContextPlaceholder>
            )}
          </>
        ) : (
          <ContextPlaceholder title="Pick the project the stock is on">The stock it has in use and the effect of the move show up here.</ContextPlaceholder>
        )
      }
    />
  );
}
