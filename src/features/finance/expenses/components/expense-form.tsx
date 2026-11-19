"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FolderKanban, Percent, ReceiptText, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ComboboxField,
  DateField,
  FormSection,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { cn } from "@/lib/utils";
import { applyFieldErrors } from "@/lib/action-result";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PROJECT_STAGES } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { gstGrandTotal, isInterState, splitGst } from "@/lib/gst";
import { LOW_CONFIDENCE, type OcrResponse } from "@/lib/ocr";
import { GST_RATES } from "@/config/company";
import { emitDataChanged } from "@/lib/events";
import type { ProjectOption } from "@/server/lookups";
import type { FileDTO } from "@/features/files/types";
import { createExpense, discardUnsavedReceipt, updateExpense } from "../actions";
import { expenseFormSchema, type ExpenseFormInput, type ExpenseFormValues } from "../schemas";
import type { ExpenseDetail } from "../types";
import { ReceiptPanel } from "./receipt-panel";
import { formValidation } from "@/components/forms/form-options";
import { useIsAdmin } from "@/components/current-user";

type Confidence = Partial<Record<FieldPath<ExpenseFormInput>, number>>;

const PAYMENT_OPTIONS = PAYMENT_METHODS.filter((m) => m.value !== "stock");
const TAX_FIELDS = new Set(["gst.cgst", "gst.sgst", "gst.igst"]);

function defaultsFrom(expense?: ExpenseDetail | null, projectId?: string): ExpenseFormInput {
  const g = expense?.gst;
  return {
    vendor: expense?.vendor ?? "",
    vendorAddress: expense?.vendorAddress ?? "",
    projectId: expense?.project?.id ?? projectId ?? undefined,
    stage: expense?.stage ?? undefined,
    category: expense?.category ?? (undefined as unknown as ExpenseFormInput["category"]),
    description: expense?.description ?? "",
    amount: expense?.amount ?? (undefined as unknown as number),
    date: expense ? toDateInput(expense.date) : toDateInput(new Date()),
    paymentMethod: expense?.paymentMethod ?? "bank_transfer",
    notes: expense?.notes ?? "",
    gst: {
      gstin: g?.gstin ?? "",
      invoiceNumber: g?.invoiceNumber ?? "",
      invoiceDate: g?.invoiceDate ? toDateInput(g.invoiceDate) : undefined,
      taxableAmount: g?.taxableAmount || undefined,
      cgst: g?.cgst || undefined,
      sgst: g?.sgst || undefined,
      igst: g?.igst || undefined,
      cess: g?.cess || undefined,
      hsnSac: g?.hsnSac ?? "",
      grandTotal: g?.grandTotal || undefined,
    },
    receiptId: expense?.receipt?.id ?? undefined,
    ocr: expense?.ocr ?? undefined,
  };
}

/**
 * Create or edit an expense. Left: the receipt (upload → OCR → preview).
 * Right: details, project & stage, the GST invoice section and notes.
 */
export function ExpenseForm({
  expense,
  projects,
  vendors,
  defaultProjectId,
  onDone,
  onCancel,
}: {
  expense?: ExpenseDetail | null;
  projects: ProjectOption[];
  vendors: string[];
  defaultProjectId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(expense);
  // Inventory expenses come from assignments; salary payments are recorded by admins only.
  const isAdmin = useIsAdmin();
  const categoryOptions = useMemo(
    () => EXPENSE_CATEGORIES.filter((o) => o.value !== "inventory" && (isAdmin || o.value !== "salaries")),
    [isAdmin],
  );
  // The rate of the last quick fill, while its taxes are untouched: they are split again if the GSTIN state changes.
  const quickRate = useRef<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<FileDTO | null>(expense?.receipt ?? null);
  const [confidence, setConfidence] = useState<Confidence>(() => {
    // Stored keys use "__" for "." (Mongo map keys cannot contain dots): gst__gstin → gst.gstin.
    const fields = expense?.ocr?.fields ?? {};
    return Object.fromEntries(
      Object.entries(fields)
        .filter(([, c]) => c < LOW_CONFIDENCE)
        .map(([k, c]) => [k.replaceAll("__", "."), c]),
    ) as Confidence;
  });
  const [ocrSummary, setOcrSummary] = useState<{ filled: number; low: number; overall: number } | null>(null);

  const form = useForm<ExpenseFormInput, unknown, ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: defaultsFrom(expense, defaultProjectId),
    ...formValidation,
  });
  const { control, setValue, getValues } = form;

  // Once the user edits an auto-filled field, it no longer needs a highlight.
  useEffect(() => {
    const sub = form.watch((_, { name, type }) => {
      if (type === "change" && name) {
        if (TAX_FIELDS.has(name)) quickRate.current = null;
        setConfidence((c) => {
          if (!(name in c)) return c;
          const next = { ...c };
          delete next[name as keyof Confidence];
          return next;
        });
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  // GST: the amount follows taxable value + taxes whenever a taxable value is entered.
  const gst = useWatch({ control, name: "gst" });
  const projectId = useWatch({ control, name: "projectId" });
  const taxable = gst?.taxableAmount ?? 0;
  const grandTotal = gstGrandTotal(gst ?? {});
  const amountLocked = taxable > 0;
  useEffect(() => {
    if (taxable > 0) {
      setValue("gst.grandTotal", grandTotal);
      setValue("amount", grandTotal, { shouldValidate: form.formState.isSubmitted });
    }
  }, [taxable, grandTotal, setValue, form.formState.isSubmitted]);

  const interState = isInterState(gst?.gstin);

  function applyRate(rate: number, inter = interState) {
    const t = getValues("gst.taxableAmount") ?? 0;
    if (!t) {
      toast.info("Enter the taxable value first.");
      return;
    }
    const split = splitGst(t, rate, inter);
    setValue("gst.cgst", split.cgst || undefined, { shouldDirty: true });
    setValue("gst.sgst", split.sgst || undefined, { shouldDirty: true });
    setValue("gst.igst", split.igst || undefined, { shouldDirty: true });
    quickRate.current = rate;
  }

  // A rate picked before the GSTIN was typed used the wrong heads (CGST + SGST vs IGST): split it again.
  // Taxes typed by hand or read from a receipt are left as they are.
  useEffect(() => {
    if (quickRate.current !== null && (getValues("gst.taxableAmount") ?? 0) > 0) applyRate(quickRate.current, interState);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of state matters here
  }, [interState]);

  function applyOcr(result: OcrResponse) {
    const previous = getValues("receiptId");
    if (previous && previous !== expense?.receipt?.id) void discardUnsavedReceipt(previous);
    setReceipt(result.file);
    setValue("receiptId", result.file.id, { shouldDirty: true });
    if (!result.ocr) return;
    quickRate.current = null;

    const f = result.ocr.fields;
    const next: Confidence = {};
    let filled = 0;
    const put = <K extends FieldPath<ExpenseFormInput>>(path: K, field: { value: unknown; confidence: number }, value?: unknown) => {
      if (field.value === null || field.value === undefined || field.value === "") return;
      setValue(path, (value ?? field.value) as never, { shouldDirty: true });
      next[path] = field.confidence;
      filled++;
    };
    put("vendor", f.vendorName);
    put("vendorAddress", f.vendorAddress);
    put("gst.gstin", f.gstin);
    put("gst.invoiceNumber", f.invoiceNumber);
    put("gst.invoiceDate", f.invoiceDate);
    if (f.invoiceDate.value) {
      setValue("date", f.invoiceDate.value);
      next.date = f.invoiceDate.confidence;
    }
    put("gst.taxableAmount", f.taxableAmount);
    put("gst.cgst", f.cgst);
    put("gst.sgst", f.sgst);
    put("gst.igst", f.igst);
    put("gst.cess", f.cess);
    put("gst.hsnSac", f.hsnSac);
    if (f.totalAmount.value !== null) {
      put("amount", f.totalAmount);
      if (!f.taxableAmount.value) setValue("gst.grandTotal", f.totalAmount.value);
    }
    if (f.paymentMethod.value && PAYMENT_OPTIONS.some((o) => o.value === f.paymentMethod.value)) put("paymentMethod", f.paymentMethod);
    setValue("ocr", {
      overall: result.ocr.overallConfidence,
      source: result.ocr.source,
      // Mongo map keys cannot contain dots, so form paths are stored as gst__gstin.
      fields: Object.fromEntries(Object.entries(next).map(([k, v]) => [k.replaceAll(".", "__"), v ?? 0])),
    });

    setConfidence(next);
    const low = Object.values(next).filter((c) => (c ?? 1) < LOW_CONFIDENCE).length;
    setOcrSummary({ filled, low, overall: result.ocr.overallConfidence });
    if (filled === 0) toast.warning("We couldn't find invoice details on this receipt. Fill the form by hand.");
    else toast.success(`Read ${filled} field${filled === 1 ? "" : "s"} from the receipt`, {
      description: low ? `${low} highlighted field${low === 1 ? "" : "s"} need a check.` : `In ${(result.ocr.durationMs / 1000).toFixed(1)}s`,
    });
  }

  function removeReceipt() {
    const current = getValues("receiptId");
    if (current && current !== expense?.receipt?.id) void discardUnsavedReceipt(current);
    setReceipt(null);
    setValue("receiptId", undefined, { shouldDirty: true });
    setValue("ocr", undefined);
    setOcrSummary(null);
    setConfidence({});
  }

  function cancel() {
    const current = getValues("receiptId");
    if (current && current !== expense?.receipt?.id) void discardUnsavedReceipt(current);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = expense ? await updateExpense({ ...values, id: expense.id }) : await createExpense(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  const c = (path: FieldPath<ExpenseFormInput>) => confidence[path];
  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        value: p.value,
        label: p.label,
        description: p.description,
        disabled: p.status === "cancelled",
        icon: <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />,
      })),
    [projects],
  );

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ReceiptPanel
          receipt={receipt}
          onRead={applyOcr}
          onRemove={removeReceipt}
          // Removing or replacing the saved receipt deletes the file, which only admins may do.
          locked={!isAdmin && Boolean(receipt) && receipt?.id === expense?.receipt?.id}
          summary={ocrSummary}
          className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-170px)]"
        />

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor="vendor" className="flex items-center gap-1 text-[13px]">
                Vendor<span className="text-danger">*</span>
                {c("vendor") !== undefined ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 py-px text-[10px] font-medium",
                      (c("vendor") ?? 1) < LOW_CONFIDENCE ? "bg-warning/15 text-warning" : "bg-success/10 text-success",
                    )}
                  >
                    {Math.round((c("vendor") ?? 0) * 100)}%
                  </span>
                ) : null}
              </FieldLabel>
              <Input
                id="vendor"
                list="expense-vendors"
                autoComplete="off"
                placeholder="Who was paid"
                aria-invalid={Boolean(form.formState.errors.vendor)}
                className={cn((c("vendor") ?? 1) < LOW_CONFIDENCE && "border-warning/70 bg-warning/5 ring-2 ring-warning/20")}
                {...form.register("vendor")}
              />
              <datalist id="expense-vendors">
                {vendors.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              {form.formState.errors.vendor ? (
                <p className="text-xs text-destructive">{form.formState.errors.vendor.message}</p>
              ) : null}
            </Field>
            <NumberField
              control={control}
              name="amount"
              label="Amount"
              currency
              required
              confidence={c("amount")}
              disabled={amountLocked}
              description={amountLocked ? "Taxable value + GST" : "Total paid, tax included"}
            />
            <DateField control={control} name="date" label="Expense date" required confidence={c("date")} />
            <SelectField
              control={control}
              name="category"
              label="Category"
              required
              options={categoryOptions}
              placeholder="Choose a category"
            />
            <SelectField
              control={control}
              name="paymentMethod"
              label="Payment method"
              required
              options={PAYMENT_OPTIONS}
              confidence={c("paymentMethod")}
            />
            <TextField
              control={control}
              name="description"
              label="Description"
              placeholder="What was this for?"
              className="sm:col-span-2"
            />
          </div>

          <FormSection
            title="Project & stage"
            description="Project expenses count toward its budget and stage-wise spending."
            icon={<FolderKanban />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <ComboboxField
                control={control}
                name="projectId"
                label="Project"
                options={projectOptions}
                placeholder="Company overhead (no project)"
                searchPlaceholder="Search projects…"
                clearable
                onSelected={(v) => !v && setValue("stage", undefined)}
              />
              <SelectField
                control={control}
                name="stage"
                label="Stage"
                required={Boolean(projectId)}
                disabled={!projectId}
                options={PROJECT_STAGES}
                placeholder={projectId ? "Choose a stage" : "Pick a project first"}
              />
            </div>
          </FormSection>

          <FormSection
            title="GST details"
            description={
              gst?.gstin
                ? interState
                  ? "Supplier is in another state: IGST applies."
                  : "Supplier is in your state: CGST + SGST apply."
                : "From the tax invoice. Leave empty for bills without GST."
            }
            icon={<Percent />}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={control}
                name="gst.gstin"
                label="Supplier GSTIN"
                placeholder="27AAPFU0939F1ZV"
                mono
                transform={(v) => v.toUpperCase().replace(/\s/g, "")}
                confidence={c("gst.gstin")}
              />
              <TextField control={control} name="gst.invoiceNumber" label="Invoice number" mono confidence={c("gst.invoiceNumber")} />
              <DateField control={control} name="gst.invoiceDate" label="Invoice date" clearable confidence={c("gst.invoiceDate")} />
              <TextField control={control} name="gst.hsnSac" label="HSN / SAC" placeholder="8536, 998314" mono confidence={c("gst.hsnSac")} />
              <NumberField control={control} name="gst.taxableAmount" label="Taxable amount" currency confidence={c("gst.taxableAmount")} />
              <div className="space-y-1.5">
                <p className="text-[13px] font-medium">Quick fill GST rate</p>
                <div className="flex flex-wrap gap-1">
                  {GST_RATES.map((rate) => (
                    <Button key={rate} type="button" variant="outline" size="sm" className="tabular h-8 px-2.5" onClick={() => applyRate(rate)}>
                      {rate}%
                    </Button>
                  ))}
                </div>
              </div>
              <NumberField control={control} name="gst.cgst" label="CGST" currency confidence={c("gst.cgst")} />
              <NumberField control={control} name="gst.sgst" label="SGST" currency confidence={c("gst.sgst")} />
              <NumberField control={control} name="gst.igst" label="IGST" currency confidence={c("gst.igst")} />
              <NumberField control={control} name="gst.cess" label="CESS" currency confidence={c("gst.cess")} />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <span className="text-sm text-muted-foreground">Grand total</span>
              <Money value={taxable > 0 ? grandTotal : (form.getValues("amount") ?? 0)} className="text-lg font-semibold" />
            </div>
            <TextareaField
              control={control}
              name="vendorAddress"
              label="Vendor address"
              rows={2}
              placeholder="As printed on the invoice"
              confidence={c("vendorAddress")}
            />
          </FormSection>

          <FormSection title="Notes" icon={<StickyNote />}>
            <TextareaField control={control} name="notes" placeholder="Anything the accountant should know" rows={3} />
          </FormSection>
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <ReceiptText className="size-3.5" />
          {receipt ? "Receipt attached" : "No receipt attached"}
        </span>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Add expense"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
