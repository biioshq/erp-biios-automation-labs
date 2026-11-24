"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowUpFromLine, CircleX, Gauge, TriangleAlert } from "lucide-react";
import { DateField, NumberField, SelectField, TextareaField } from "@/components/forms/fields";
import { useOnLiveChange } from "@/components/live-updates";
import { Money } from "@/components/shared/money";
import { StatusBadge, StockStatusBadge } from "@/components/shared/status-badge";
import { applyFieldErrors } from "@/lib/action-result";
import { PROJECT_STAGES, labelOf } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatNumber, round2 } from "@/lib/format";
import { getStockStatus } from "@/lib/stock-status";
import { assignStockAction, fetchProjectImpact } from "../actions";
import { assignFormSchema, type AssignFormInput, type AssignFormValues } from "../schemas";
import { splitAssignment } from "../stock-cost";
import type { LedgerItem, LedgerProject, ProjectImpact } from "../types";
import { ItemCard, StatusDot } from "./item-card";
import { ContextPlaceholder, ImpactRow, OperationForm, OperationLayout, SubmitBar } from "./operation-layout";
import { PickerField, type PickerOption } from "./picker-field";
import { formValidation } from "@/components/forms/form-options";

const FORM_ID = "assign-stock-form";

const OUT_OF_STOCK_HINT = "This item must be purchased before it can be allocated";

function defaultsFor(itemId?: string, projectId?: string, stage?: AssignFormInput["stage"]): AssignFormInput {
  return {
    itemId: itemId as string,
    projectId: projectId as string,
    stage: stage as AssignFormInput["stage"],
    quantity: undefined as unknown as number,
    date: toDateInput(new Date()),
    note: "",
  };
}

export function AssignView({
  items,
  projects,
  defaultItemId,
  defaultProjectId,
  recent,
}: {
  items: LedgerItem[];
  projects: LedgerProject[];
  defaultItemId?: string;
  defaultProjectId?: string;
  recent: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const initialItem = items.find((i) => i.id === defaultItemId);
  const initialProject = projects.find((p) => p.id === defaultProjectId && p.status !== "cancelled" && p.status !== "completed");
  // An out-of-stock item from a link cannot be selected: show why instead.
  const blockedPrefill = initialItem && initialItem.available <= 0 ? initialItem : null;

  // Quantity is capped at what is available right now.
  const schema = useMemo(
    () =>
      assignFormSchema.superRefine((v, ctx) => {
        const it = items.find((i) => i.id === v.itemId);
        if (it && v.quantity > it.available) {
          ctx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: it.available > 0 ? `Only ${formatNumber(it.available)} ${it.unit} available` : "Nothing available. Purchase this item first",
          });
        }
      }),
    [items],
  );

  const form = useForm<AssignFormInput, unknown, AssignFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultsFor(blockedPrefill ? undefined : initialItem?.id, initialProject?.id),
    ...formValidation,
  });
  const { control } = form;

  const itemId = useWatch({ control, name: "itemId" });
  const projectId = useWatch({ control, name: "projectId" });
  const stage = useWatch({ control, name: "stage" });
  const qty = useWatch({ control, name: "quantity" });
  const item = items.find((i) => i.id === itemId);
  const project = projects.find((p) => p.id === projectId);
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const overQuantity = Boolean(item && quantity > item.available);

  const [impact, setImpact] = useState<{ projectId: string; data: ProjectImpact | null } | null>(null);
  const [impactVersion, setImpactVersion] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProjectImpact(projectId).then((data) => {
      if (!cancelled) setImpact({ projectId, data });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, impactVersion]);
  // Other people's changes move the project's spend: reload the budget preview (the form is not
  // reset, so typing is kept). Also fires after this tab's own save.
  useOnLiveChange(() => setImpactVersion((v) => v + 1));
  const projectImpact = impact && impact.projectId === projectId ? impact.data : null;
  const loadingImpact = Boolean(projectId) && !(impact && impact.projectId === projectId);

  const itemOptions = useMemo<PickerOption[]>(
    () =>
      items.map((i) => ({
        value: i.id,
        label: i.name,
        description:
          i.available <= 0
            ? [i.variant, OUT_OF_STOCK_HINT].filter(Boolean).join(" · ")
            : [i.sku, i.variant, `${formatNumber(i.available)} ${i.unit} available`].filter(Boolean).join(" · "),
        disabled: i.available <= 0,
        leading: <StatusDot status={i.status} />,
        trailing: i.status === "in_stock" ? undefined : <StockStatusBadge status={i.status} />,
      })),
    [items],
  );

  const projectOptions = useMemo<PickerOption[]>(
    () =>
      projects.map((p) => {
        const closed = p.status === "cancelled" || p.status === "completed";
        return {
          value: p.id,
          label: p.name,
          description: closed ? `${p.description ? `${p.description} · ` : ""}${p.status === "completed" ? "Completed" : "Cancelled"}, cannot take stock` : p.description,
          disabled: closed,
          leading: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
          trailing: closed ? <StatusBadge tone="neutral" dot={false}>{p.status === "completed" ? "Completed" : "Cancelled"}</StatusBadge> : undefined,
        };
      }),
    [projects],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await assignStockAction(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const r = result.data;
      // Stock expensed when it was bought only moves its cost into the project; older stock is expensed now.
      const parts = [
        r.countedAtPurchaseCost > 0 ? `${formatCurrency(r.countedAtPurchaseCost)} moved into the project's budget (counted when bought)` : "",
        r.companyCost > 0 ? `${formatCurrency(r.companyCost)} added to expenses` : "",
      ].filter(Boolean);
      toast.success(
        `Assigned ${formatNumber(r.quantity)} ${r.unit} of ${r.itemName} to ${r.projectName}.${r.expenseNumber ? ` Expense ${r.expenseNumber}.` : ""}`,
        parts.length ? { description: `${parts.join(", ")}.` } : undefined,
      );
      emitDataChanged();
      // Several items often go to the same project and stage, so those stay selected.
      form.reset({ ...defaultsFor(undefined, values.projectId, values.stage), itemId: "" });
    });
  });

  const preview = item && quantity > 0 && !overQuantity ? previewAssign(item, quantity, projectImpact, stage) : null;

  const submitBar = (className: string) => (
    <SubmitBar
      className={className}
      formId={FORM_ID}
      pending={pending}
      disabled={overQuantity}
      label="Assign to project"
      icon={<ArrowUpFromLine />}
      note={
        preview ? (
          <>
            Books <Money value={preview.cost} className="font-medium text-foreground" /> to {project?.name ?? "the project"}
          </>
        ) : (
          "The cost is booked to the project when you save. Stock already expensed at purchase is not added to company expenses again."
        )
      }
    />
  );

  return (
    <OperationLayout
      recent={recent}
      form={
        <OperationForm id={FORM_ID} onSubmit={onSubmit}>
          {blockedPrefill ? (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm">
              <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="space-y-1">
                <p className="font-medium text-danger">{blockedPrefill.name} is out of stock</p>
                <p className="text-muted-foreground">
                  {OUT_OF_STOCK_HINT}.{" "}
                  <Link href={`/inventory/purchase?item=${blockedPrefill.id}`} className="font-medium text-brand-ink hover:underline">
                    Purchase it now
                  </Link>
                </p>
              </div>
            </div>
          ) : null}

          <PickerField
            control={control}
            name="itemId"
            label="Item"
            required
            options={itemOptions}
            placeholder="Choose an item from stock"
            searchPlaceholder="Search by name or SKU…"
            description={
              items.some((i) => i.available <= 0) ? (
                <>
                  Out of stock items can&apos;t be picked until new stock is{" "}
                  <Link href="/inventory/purchase" className="font-medium text-brand-ink hover:underline">
                    purchased
                  </Link>
                  .
                </>
              ) : undefined
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField
              control={control}
              name="projectId"
              label="Project"
              required
              options={projectOptions}
              placeholder="Choose a project"
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
              description="The expense is booked under this stage."
            />
            <NumberField
              control={control}
              name="quantity"
              label="Quantity"
              required
              suffix={item?.unit}
              description={
                item ? (
                  <span className={overQuantity ? "text-danger" : undefined}>
                    {overQuantity ? `Only ${formatNumber(item.available)} ${item.unit} available` : `Up to ${formatNumber(item.available)} ${item.unit} available`}
                  </span>
                ) : undefined
              }
            />
            <DateField control={control} name="date" label="Assignment date" required />
          </div>

          <TextareaField control={control} name="note" label="Note" rows={2} placeholder="What the stock is for (optional)" />

          <div className="hidden border-t pt-5 lg:block">{submitBar("")}</div>
        </OperationForm>
      }
      submit={submitBar("lg:hidden")}
      context={
        item ? (
          <>
            <ItemCard item={item} showExpensed />
            {preview ? (
              <ImpactPanel
                item={item}
                projectName={project?.name}
                preview={preview}
                stage={stage}
                loading={loadingImpact}
                hasProject={Boolean(project)}
              />
            ) : (
              <ContextPlaceholder title="See the impact before you assign">
                {project ? "Enter a quantity to preview stock levels and project spend." : "Pick a project and a quantity to preview stock levels and project spend."}
              </ContextPlaceholder>
            )}
          </>
        ) : (
          <ContextPlaceholder title="Pick an item">Its availability and what this assignment changes show up here.</ContextPlaceholder>
        )
      }
    />
  );
}

type AssignPreview = ReturnType<typeof previewAssign>;

function previewAssign(item: LedgerItem, quantity: number, impact: ProjectImpact | null, stage: string | undefined) {
  // The same split the ledger books: already-expensed units first, each lot at its own cost.
  const split = splitAssignment(item, quantity);
  const cost = split.total;
  const availableAfter = item.available - quantity;
  const statusAfter = getStockStatus(availableAfter, item.minStock);
  const budget = impact?.budget ?? 0;
  const spent = impact?.spent ?? 0;
  const remainingBefore = round2(budget - spent);
  const remainingAfter = round2(budget - spent - cost);
  return {
    cost,
    companyCost: split.companyAmount,
    countedCost: split.countedAmount,
    availableAfter,
    allocatedAfter: item.allocated + quantity,
    statusAfter,
    budget,
    spent,
    spentAfter: round2(spent + cost),
    stageSpent: stage ? (impact?.byStage[stage] ?? 0) : 0,
    salariesHidden: impact?.salariesHidden ?? false,
    // No figures come back for people who may not see project budgets and spend.
    hasImpact: impact !== null,
    remainingBefore,
    remainingAfter,
    hasBudget: budget > 0,
    overBudget: budget > 0 && remainingAfter < 0,
    droppedToLow: statusAfter === "low_stock" && item.status === "in_stock",
    emptied: availableAfter <= 0,
  };
}

function ImpactPanel({
  item,
  projectName,
  preview,
  stage,
  loading,
  hasProject,
}: {
  item: LedgerItem;
  projectName?: string;
  preview: AssignPreview;
  stage?: AssignFormInput["stage"];
  loading: boolean;
  hasProject: boolean;
}) {
  const unit = item.unit;
  return (
    <section className="rounded-xl border bg-card p-4 shadow-card sm:p-5">
      <p className="eyebrow flex items-center gap-1.5">
        <Gauge className="size-3.5" /> Impact of this assignment
      </p>
      <div className="mt-2 divide-y">
        <ImpactRow label="Available" before={item.available} after={preview.availableAfter} format={(n) => `${formatNumber(n)} ${unit}`} />
        <ImpactRow label="In use on projects" before={item.allocated} after={preview.allocatedAfter} format={(n) => `${formatNumber(n)} ${unit}`} />
        {hasProject ? (
          loading ? (
            <p className="py-2 text-sm text-muted-foreground">Loading project budget…</p>
          ) : !preview.hasImpact ? null : (
            <>
              <ImpactRow
                label={`${projectName} spend${stage ? ` (${labelOf(PROJECT_STAGES, stage)})` : ""}`}
                before={preview.spent}
                after={preview.spentAfter}
                format={(n) => <Money value={n} />}
              />
              {preview.hasBudget ? (
                <ImpactRow
                  label="Budget remaining"
                  before={preview.remainingBefore}
                  after={preview.remainingAfter}
                  format={(n) => <Money value={n} />}
                  tone={preview.overBudget ? "bad" : undefined}
                />
              ) : (
                <p className="py-2 text-sm text-muted-foreground">This project has no budget set.</p>
              )}
              {preview.salariesHidden ? (
                <p className="py-2 text-xs text-muted-foreground">Spend excludes salaries, which your role cannot see.</p>
              ) : null}
            </>
          )
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            Adds <Money value={preview.cost} /> to the project you pick.
          </p>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">Cost to the project</span>
        <Money value={preview.cost} className="font-semibold" />
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <dt>Added to expenses</dt>
          <dd>
            <Money value={preview.companyCost} className="font-medium text-foreground" />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt>Already expensed at purchase</dt>
          <dd>
            <Money value={preview.countedCost} className="font-medium text-foreground" />
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2 empty:hidden">
        {preview.emptied ? (
          <Warning tone="danger">This leaves no {item.name} available. It will show as Out of Stock.</Warning>
        ) : preview.droppedToLow ? (
          <Warning>
            {item.name} drops into Low Stock: {formatNumber(preview.availableAfter)} {unit} left against a minimum of {formatNumber(item.minStock)}.
          </Warning>
        ) : preview.statusAfter === "low_stock" ? (
          <Warning>{item.name} is already at Low Stock. Consider purchasing more.</Warning>
        ) : null}
        {preview.overBudget && !loading ? (
          <Warning tone="danger">
            This pushes {projectName} over budget by <Money value={Math.abs(preview.remainingAfter)} />.
          </Warning>
        ) : null}
      </div>
    </section>
  );
}

function Warning({ tone = "warning", children }: { tone?: "warning" | "danger"; children: React.ReactNode }) {
  return (
    <p
      role="status"
      className={
        tone === "danger"
          ? "flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
          : "flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
      }
    >
      <TriangleAlert className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
