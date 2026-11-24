"use client";

import { useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarClock, CreditCard, Paperclip, ShieldCheck, StickyNote, TrendingDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, type FileDTO } from "@/features/files/types";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import type { GroupOption } from "@/features/finance/groups/types";
import { applyFieldErrors } from "@/lib/action-result";
import { ASSET_CONDITIONS, ASSET_FUNDING, DEPARTMENTS, DEPRECIATION_METHODS } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankAccountOption, EmployeeOption, ProjectOption } from "@/server/lookups";
import { createFixedAsset, discardUnsavedAssetFile, updateFixedAsset } from "../actions";
import { labelsFor, type AssetKind } from "../labels";
import { PAID_METHODS, assetFormSchema, type AssetFormInput, type AssetFormValues } from "../schemas";
import type { AssetDetail } from "../types";
import { ExpensePicker, type PickedExpense } from "./expense-picker";

export type AssetFormOptions = {
  groups: GroupOption[];
  accounts: BankAccountOption[];
  employees: EmployeeOption[];
  projects: ProjectOption[];
  vendors: string[];
  locations: string[];
};

const FUNDING_HINTS: Record<string, string> = {
  expense: "The purchase is already in Expenses. Its cost becomes the asset's, so it is not counted twice.",
  paid: "Paid straight from a bank or cash account. No expense is created.",
  unpaid: "Creates one unpaid bill from the vendor in Expenses. Record payments against it there.",
  opening: "Owned before the books in this ERP started. Carried at cost against opening balances.",
};

function defaultsFrom(kind: AssetKind, asset?: AssetDetail | null, group?: string): AssetFormInput {
  const life = kind === "intangible" ? 3 : 5;
  return {
    kind,
    name: asset?.name ?? "",
    group: asset?.group ?? group ?? "",
    description: asset?.description ?? "",
    quantity: asset?.quantity ?? 1,
    purchaseDate: asset ? toDateInput(asset.purchaseDate) : toDateInput(new Date()),
    purchaseCost: asset?.purchaseCost ?? (undefined as unknown as number),
    salvageValue: asset?.salvageValue ?? 0,
    usefulLifeYears: asset ? asset.usefulLifeYears || undefined : life,
    depreciationMethod: asset?.depreciationMethod ?? "slm",
    wdvRate: asset?.wdvRate ?? undefined,
    depreciationStart: asset?.depreciationStart ? toDateInput(asset.depreciationStart) : "",
    vendor: asset?.vendor ?? "",
    invoiceNumber: asset?.invoiceNumber ?? "",
    location: asset?.location ?? "",
    department: asset?.department ?? "",
    assignedToId: asset?.assignedTo?.id ?? undefined,
    isEquipment: asset?.isEquipment ?? false,
    projectId: asset?.project?.id ?? undefined,
    projectUntil: asset?.projectUntil ? toDateInput(asset.projectUntil) : "",
    condition: asset?.condition ?? "good",
    warrantyUntil: asset?.warrantyUntil ? toDateInput(asset.warrantyUntil) : "",
    warrantyNotes: asset?.warrantyNotes ?? "",
    notes: asset?.notes ?? "",
    funding: {
      mode: asset?.funding.mode === "unpaid" ? "expense" : (asset?.funding.mode ?? "paid"),
      expenseId: asset?.funding.expense?.id ?? undefined,
      paymentMethod: asset?.funding.paymentMethod ?? "bank_transfer",
      accountId: asset?.funding.account?.id ?? undefined,
      dueDate: "",
    },
    documentIds: [],
  };
}

/** Create or edit a fixed or intangible asset: what it is, how it was paid, how it depreciates, where it is. */
export function AssetForm({
  kind,
  asset,
  options,
  defaultGroup,
  canDeleteBills = false,
  onDone,
  onCancel,
}: {
  kind: AssetKind;
  asset?: AssetDetail | null;
  options: AssetFormOptions;
  defaultGroup?: string;
  /** People who may delete assets and expenses may delete the unpaid bill the asset created when it stops pointing at it. */
  canDeleteBills?: boolean;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const labels = labelsFor(kind);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<PickedExpense | null>(asset?.funding.expense ?? null);
  const [files, setFiles] = useState<FileDTO[]>([]);
  // Subgroups added from this form show at once; the page refresh then brings their real place and name.
  const [added, setAdded] = useState<GroupOption[]>([]);
  const groups = useMemo(() => [...options.groups, ...added.filter((a) => !options.groups.some((g) => g.key === a.key))], [options.groups, added]);
  const form = useForm<AssetFormInput, unknown, AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: defaultsFrom(kind, asset, defaultGroup),
    ...formValidation,
  });
  const { control, setValue, getValues, setError, register } = form;
  const mode = useWatch({ control, name: "funding.mode" });
  const method = useWatch({ control, name: "depreciationMethod" });
  const projectId = useWatch({ control, name: "projectId" });
  const expenseError = form.formState.errors.funding?.expenseId;

  const groupOptions = useMemo(() => {
    const minDepth = Math.min(...groups.map((g) => g.depth));
    return groups.map((g) => ({ value: g.key, label: `${"  ".repeat(g.depth - minDepth)}${g.label}`, description: g.builtIn ? undefined : "Subgroup" }));
  }, [groups]);
  const conditionOptions = ASSET_CONDITIONS.filter((c) => c.value !== "disposed" || asset?.disposal);
  const accountOptions = options.accounts.map((a) => ({ value: a.value, label: a.label, description: a.description }));
  const employeeOptions = options.employees.map((e) => ({ value: e.value, label: e.label, description: e.description, disabled: e.status === "exited" }));
  const projectOptions = options.projects.map((p) => ({
    value: p.value,
    label: p.label,
    description: p.description,
    disabled: p.status === "cancelled",
    icon: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
  }));
  const linkedBefore = asset?.funding.expense ?? null;
  // "Not paid yet" on an asset that has the bill it created keeps that bill (the server never makes a second one).
  const keepsOwnBill = mode === "unpaid" && Boolean(linkedBefore?.createdWithAsset);
  const unlinking = Boolean(linkedBefore && !keepsOwnBill && (mode !== "expense" || (picked && picked.id !== linkedBefore.id)));
  const canDeleteBill = unlinking && Boolean(asset?.deletableBill) && canDeleteBills;
  const [deleteBill, setDeleteBill] = useState(false);

  function pickExpense(e: PickedExpense) {
    setPicked(e);
    setValue("funding.expenseId", e.id, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    // GST shown on the bill is usually claimed back, so it is not part of the asset's cost.
    setValue("purchaseCost", round2(e.amount - (e.gst ?? 0)), { shouldDirty: true });
    setValue("purchaseDate", toDateInput(e.date), { shouldDirty: true });
    if (!getValues("vendor")) setValue("vendor", e.vendor, { shouldDirty: true });
  }

  function cancel() {
    for (const f of files) void discardUnsavedAssetFile(f.id);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload = { ...values, documentIds: files.map((f) => f.id) };
      const result = asset ? await updateFixedAsset({ ...payload, id: asset.id, deleteBill: canDeleteBill && deleteBill }) : await createFixedAsset(payload);
      if (!result.ok) {
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  const vendorError = form.formState.errors.vendor;

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Name" required placeholder={labels.namePlaceholder} className="sm:col-span-2" />
          <div className="space-y-2 sm:col-span-2">
            <SelectField control={control} name="group" label="Group" required options={groupOptions} placeholder="Pick a group or subgroup" />
            <AddSubgroupButton
              parents={groups.filter((g) => !g.archived)}
              defaultParent={getValues("group") || labels.root}
              label="Add subgroup"
              variant="ghost"
              onAdded={(key) => {
                const parent = getValues("group") || labels.root;
                const p = groups.find((g) => g.key === parent);
                setAdded((gs) => [...gs, { key, label: "New subgroup", parent, kind: "asset", builtIn: false, description: null, details: null, archived: false, depth: (p?.depth ?? 0) + 1, path: "" }]);
                setValue("group", key, { shouldDirty: true });
              }}
            />
          </div>
          <NumberField control={control} name="quantity" label="Quantity" required step="any" description="Units covered by this record" />
          <SelectField control={control} name="condition" label="Condition" required options={conditionOptions} />
          <TextareaField control={control} name="description" label="Description" placeholder="Model, size, serial numbers" className="sm:col-span-2" rows={2} />
        </div>

        <FormSection title="Purchase" description="Who it was bought from and when." icon={<CalendarClock />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              control={control}
              name="purchaseDate"
              label="Purchase date"
              required
              description={mode === "expense" || keepsOwnBill ? "The expense's date. Use the start date below for when it was put to use." : undefined}
            />
            <Field data-invalid={vendorError ? true : undefined} className="gap-1.5">
              <FieldLabel htmlFor="vendor" className="text-[13px]">
                <span>
                  Vendor{mode === "unpaid" ? <span className="ml-0.5 text-danger">*</span> : null}
                </span>
              </FieldLabel>
              <Input id="vendor" list="asset-vendors" autoComplete="off" placeholder="Who sold it" aria-invalid={Boolean(vendorError)} {...register("vendor")} />
              <datalist id="asset-vendors">
                {options.vendors.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <FieldError errors={vendorError ? [vendorError] : undefined} className="text-xs" />
            </Field>
            <TextField control={control} name="invoiceNumber" label="Invoice number" mono className="sm:col-span-2" />
          </div>
        </FormSection>

        <FormSection title="How it was paid" description="Recorded once. Pick the expense if the purchase is already in Expenses." icon={<CreditCard />}>
          <Controller
            control={control}
            name="funding.mode"
            render={({ field }) => (
              <div role="radiogroup" aria-label="How it was paid" className="grid gap-2 sm:grid-cols-2">
                {ASSET_FUNDING.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={field.value === o.value}
                    onClick={() => field.onChange(o.value)}
                    className={cn(
                      "rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-foreground/20",
                      field.value === o.value && "border-brand bg-brand/5 ring-1 ring-brand/30",
                    )}
                  >
                    <span className="block font-medium">{o.value === "expense" ? "Already recorded as an expense" : o.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{FUNDING_HINTS[o.value]}</span>
                  </button>
                ))}
              </div>
            )}
          />
          {mode === "expense" ? (
            <div className="space-y-2">
              <ExpensePicker value={picked} assetId={asset?.id} invalid={Boolean(expenseError)} onChange={pickExpense} />
              {expenseError ? <p className="text-xs text-danger">{expenseError.message}</p> : null}
              {picked ? (
                <p className="text-xs text-muted-foreground">
                  Expense amount <Money value={picked.amount} />
                  {picked.gst ? (
                    <>
                      , GST on it <Money value={picked.gst} />
                    </>
                  ) : null}
                  . The purchase cost below can be lower (GST claimed back) but not higher.
                </p>
              ) : null}
            </div>
          ) : null}
          {mode === "paid" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={control} name="funding.paymentMethod" label="Paid by" required options={PAID_METHODS} />
              <SelectField
                control={control}
                name="funding.accountId"
                label="Paid from"
                options={accountOptions}
                clearable
                placeholder="Default account for this method"
                description={accountOptions.length ? undefined : "No bank or cash accounts are set up yet (Cash & bank)."}
              />
            </div>
          ) : null}
          {mode === "unpaid" && keepsOwnBill && linkedBefore ? (
            <p className="rounded-lg border bg-surface/40 px-3 py-2 text-xs text-muted-foreground">
              The bill {linkedBefore.number} created with this asset stays as it is. Change its due date or record payments in Expenses.
            </p>
          ) : mode === "unpaid" ? (
            <DateField control={control} name="funding.dueDate" label="Bill due on" description="Leave empty when it is due on the purchase date." />
          ) : null}
          {unlinking && linkedBefore ? (
            <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              <p>
                {canDeleteBill && deleteBill
                  ? `${linkedBefore.number} will be deleted when you save.`
                  : `${linkedBefore.number} will be unlinked and stays in Expenses as a running cost. Delete it there if it was only for this asset.`}
              </p>
              {canDeleteBill ? (
                <label className="flex items-center gap-2 text-foreground">
                  <input type="checkbox" checked={deleteBill} onChange={(e) => setDeleteBill(e.target.checked)} className="size-4 accent-current" />
                  Delete {linkedBefore.number}: it was created with this asset and nothing is paid on it
                </label>
              ) : null}
            </div>
          ) : null}
        </FormSection>

        <FormSection title={`Cost and ${labels.chargeLower}`} description={`${labels.charge} is computed month by month from these figures.`} icon={<TrendingDown />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={control}
              name="purchaseCost"
              label="Purchase cost"
              currency
              required
              description="Total for all units. Leave GST out when it was claimed as input credit."
            />
            <SelectField control={control} name="depreciationMethod" label="Method" required options={DEPRECIATION_METHODS} />
            {method === "wdv" ? (
              <NumberField control={control} name="wdvRate" label="Yearly rate" suffix="%" required step="any" />
            ) : null}
            {method !== "none" ? (
              <NumberField control={control} name="usefulLifeYears" label="Useful life" suffix="years" required={method === "slm"} step="any" />
            ) : null}
            {method !== "none" ? <NumberField control={control} name="salvageValue" label="Salvage value" currency description="What it is worth at the end of its life" /> : null}
            {method !== "none" ? (
              <DateField control={control} name="depreciationStart" label={`${labels.charge} starts`} description="When it was put to use. Empty means the purchase date." />
            ) : null}
          </div>
        </FormSection>

        <FormSection title="Allocation" description="Where it is and who has it." icon={<Users />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="location" className="text-[13px]">
                {labels.locationLabel}
              </FieldLabel>
              <Input id="location" list="asset-locations" autoComplete="off" placeholder="Pune office, workshop, site" {...register("location")} />
              <datalist id="asset-locations">
                {options.locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </Field>
            <SelectField control={control} name="department" label="Department" options={DEPARTMENTS} clearable placeholder="No department" />
            <ComboboxField
              control={control}
              name="assignedToId"
              label="Assigned to"
              options={employeeOptions}
              clearable
              placeholder="Nobody in particular"
              searchPlaceholder="Search employees…"
              className="sm:col-span-2"
            />
            {kind === "tangible" ? (
              <Controller
                control={control}
                name="isEquipment"
                render={({ field }) => (
                  <label className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 sm:col-span-2">
                    <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} className="mt-0.5" />
                    <span className="text-sm">
                      <span className="block font-medium">Equipment for projects</span>
                      <span className="block text-xs text-muted-foreground">Tools and machines that move between projects. Analytics uses this for availability.</span>
                    </span>
                  </label>
                )}
              />
            ) : null}
            <ComboboxField
              control={control}
              name="projectId"
              label="With project"
              options={projectOptions}
              clearable
              placeholder="Not with a project"
              searchPlaceholder="Search projects…"
            />
            <DateField control={control} name="projectUntil" label="Until" disabled={!projectId} description={projectId ? "When it is due back" : "Pick a project first"} />
          </div>
        </FormSection>

        <FormSection title="Warranty" icon={<ShieldCheck />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name="warrantyUntil" label={kind === "intangible" ? "Licence or support until" : "Warranty until"} />
            <TextareaField control={control} name="warrantyNotes" label="Details" placeholder="Provider, terms, AMC contact" rows={2} className="sm:col-span-2" />
          </div>
        </FormSection>

        {!asset ? (
          <FormSection title="Documents" description="Purchase invoice, warranty card, photos. More can be added later." icon={<Paperclip />}>
            {files.length ? (
              <div className="grid gap-2">
                {files.map((f) => (
                  <FileTile
                    key={f.id}
                    file={f}
                    onRemove={() => {
                      void discardUnsavedAssetFile(f.id);
                      setFiles((list) => list.filter((x) => x.id !== f.id));
                    }}
                  />
                ))}
              </div>
            ) : null}
            <FileDropzone meta={{ kind: "document" }} accept={ACCEPT_DOCUMENTS} compact title="Drop documents or click to browse" onUploaded={(f) => setFiles((list) => [...list, f])} />
          </FormSection>
        ) : null}

        <FormSection title="Notes" icon={<StickyNote />}>
          <TextareaField control={control} name="notes" placeholder="Anything the accountant should know" rows={3} />
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {asset ? "Save changes" : "Add asset"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
