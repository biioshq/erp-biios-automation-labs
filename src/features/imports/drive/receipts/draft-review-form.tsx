"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FolderKanban, Percent, RefreshCw, StickyNote, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { PAYMENT_METHODS, PROJECT_STAGES } from "@/lib/constants";
import { expenseCategoryChoices, type ExpenseCategoryOption } from "@/lib/expense-categories";
import { gstGrandTotal, isInterState } from "@/lib/gst";
import { emitDataChanged } from "@/lib/events";
import { FileViewer } from "@/features/files/components/file-preview";
import { expenseFormSchema, type ExpenseFormInput, type ExpenseFormValues } from "@/features/finance/expenses/schemas";
import type { ProjectOption } from "@/server/lookups";
import { discardReceiptDraftAction, saveReceiptDraftAction, updateReceiptDraftAction } from "./actions";
import type { DraftFormValues, ReceiptDraft } from "./types";

const PAYMENT_OPTIONS = PAYMENT_METHODS.filter((m) => m.value !== "stock");

type Confidence = Partial<Record<FieldPath<ExpenseFormInput>, number>>;

/**
 * Review one Drive bill: the stored receipt on the left, the expense form's fields on the right,
 * with fields read at low confidence highlighted as in the expense form. "Save as expense" checks
 * the values with the expense form's schema, then saves through the same create logic.
 */
export function DraftReviewForm({
  draft,
  projects,
  categories,
  unsavedRef,
  onSaved,
  onDiscarded,
  onKept,
  onReread,
  onCancel,
}: {
  draft: ReceiptDraft;
  projects: ProjectOption[];
  categories: ExpenseCategoryOption[];
  /** Set to a function giving the edited values (or null when nothing changed), so closing the panel keeps them. */
  unsavedRef: React.RefObject<(() => DraftFormValues | null) | null>;
  onSaved: (draftId: string, number: string) => void;
  onDiscarded: (draftId: string) => void;
  onKept: (draftId: string, values: DraftFormValues) => void;
  /** Reads the stored bill again; resolves with the refreshed draft, or null. */
  onReread: (draftId: string) => Promise<ReceiptDraft | null>;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [rereading, setRereading] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [confidence, setConfidence] = useState<Confidence>(() => draft.confidence as Confidence);
  const form = useForm<ExpenseFormInput, unknown, ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: draft.values as ExpenseFormInput,
    ...formValidation,
  });
  const { control, setValue, getValues } = form;

  // Once a highlighted field is edited, it no longer needs the highlight.
  useEffect(() => {
    const sub = form.watch((_, { name, type }) => {
      if (type === "change" && name) {
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

  // As in the expense form, the amount follows taxable value plus GST when a taxable value is set.
  const gst = useWatch({ control, name: "gst" });
  const projectId = useWatch({ control, name: "projectId" });
  const amount = useWatch({ control, name: "amount" });
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

  const currentCategory = draft.values.category || undefined;
  const categoryOptions = useMemo(
    () => expenseCategoryChoices(categories, { current: currentCategory, allowSalaries: true }),
    [categories, currentCategory],
  );
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
  const currentValues = (): DraftFormValues => {
    const { receiptId: _r, ocr: _o, ...values } = getValues();
    return values;
  };
  const c = (path: FieldPath<ExpenseFormInput>) => confidence[path];
  useEffect(() => {
    unsavedRef.current = () => (form.formState.isDirty ? currentValues() : null);
    return () => {
      unsavedRef.current = null;
    };
  });

  const save = form.handleSubmit((values) => {
    startTransition(async () => {
      const { receiptId: _r, ocr: _o, ...rest } = values;
      const result = await saveReceiptDraftAction({ id: draft.id, values: rest });
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`Saved as ${result.data.number}`);
      emitDataChanged();
      onSaved(draft.id, result.data.number);
    });
  });

  function keep() {
    startTransition(async () => {
      const values = currentValues();
      const result = await updateReceiptDraftAction({ id: draft.id, values });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft kept. You can finish it later.");
      onKept(draft.id, values);
    });
  }

  async function reread() {
    setRereading(true);
    try {
      // Keep what was typed first: reading again only fills fields that are still empty.
      if (form.formState.isDirty) await updateReceiptDraftAction({ id: draft.id, values: currentValues() });
      const next = await onReread(draft.id);
      if (next) {
        form.reset(next.values as ExpenseFormInput);
        setConfidence(next.confidence as Confidence);
      }
    } finally {
      setRereading(false);
    }
  }

  async function discard() {
    const result = await discardReceiptDraftAction({ id: draft.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Draft discarded");
    onDiscarded(draft.id);
  }

  const busy = pending || rereading;

  // A likely duplicate is saved only after a confirmation, as with "Save ticked". This also
  // catches Enter in a field, which submits the form without the button.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    if (draft.duplicates.length) {
      e.preventDefault();
      if (!busy) setConfirmDuplicate(true);
      return;
    }
    void save(e);
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-170px)]">
          <div className="h-[45dvh] overflow-hidden rounded-lg border bg-surface/40 lg:h-[calc(100dvh-260px)]">
            {draft.file ? (
              <FileViewer file={draft.file} className="h-full" />
            ) : (
              <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">The stored bill is missing. Fill the expense in by hand.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={draft.fileName}>
              {draft.fileName}
              {draft.overallConfidence !== null ? ` · read with ${Math.round(draft.overallConfidence * 100)}% confidence` : ""}
            </span>
            {draft.file ? (
              <Button type="button" variant="outline" size="sm" onClick={reread} disabled={busy}>
                {rereading ? <Spinner /> : <RefreshCw />} Read again
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          {draft.duplicates.length ? (
            <Alert className="border-warning/40 bg-warning/5">
              <TriangleAlert className="text-warning" />
              <AlertTitle>This may already be recorded</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {draft.duplicates.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <p>Check before saving, or discard it if it is a copy.</p>
              </AlertDescription>
            </Alert>
          ) : null}
          {draft.ocrError ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Not read automatically</AlertTitle>
              <AlertDescription>{draft.ocrError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="vendor" label="Vendor" required placeholder="Who was paid" className="sm:col-span-2" confidence={c("vendor")} />
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
            <SelectField control={control} name="category" label="Category" required options={categoryOptions} placeholder="Choose a category" />
            <SelectField control={control} name="paymentMethod" label="Payment method" required options={PAYMENT_OPTIONS} confidence={c("paymentMethod")} />
            <TextField control={control} name="description" label="Description" placeholder="What was this for?" className="sm:col-span-2" />
          </div>

          <FormSection title="Project & stage" description="Project expenses count toward its budget and stage-wise spending." icon={<FolderKanban />}>
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
              <TextField control={control} name="gst.hsnSac" label="HSN / SAC" mono confidence={c("gst.hsnSac")} />
              <NumberField control={control} name="gst.taxableAmount" label="Taxable amount" currency confidence={c("gst.taxableAmount")} />
              <NumberField control={control} name="gst.cess" label="CESS" currency confidence={c("gst.cess")} />
              <NumberField control={control} name="gst.cgst" label="CGST" currency confidence={c("gst.cgst")} />
              <NumberField control={control} name="gst.sgst" label="SGST" currency confidence={c("gst.sgst")} />
              <NumberField control={control} name="gst.igst" label="IGST" currency confidence={c("gst.igst")} />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
              <span className="text-sm text-muted-foreground">Grand total</span>
              <Money value={taxable > 0 ? grandTotal : (amount ?? 0)} className="text-lg font-semibold" />
            </div>
            <TextareaField control={control} name="vendorAddress" label="Vendor address" rows={2} placeholder="As printed on the invoice" confidence={c("vendorAddress")} />
          </FormSection>

          <FormSection title="Notes" icon={<StickyNote />}>
            <TextareaField control={control} name="notes" placeholder="Anything the accountant should know" rows={3} />
          </FormSection>
        </div>
      </FormSheetBody>
      <FormSheetFooter>
        <ConfirmDialog
          trigger={
            <Button type="button" variant="ghost" className="mr-auto text-danger hover:text-danger" disabled={busy}>
              <Trash2 /> Discard
            </Button>
          }
          title="Discard this draft?"
          description="The bill stored for it is deleted. The file stays in Google Drive and is skipped on later imports unless you tick the option to import discarded files again."
          confirmLabel="Discard"
          onConfirm={discard}
        />
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Close
        </Button>
        <Button type="button" variant="outline" onClick={keep} disabled={busy}>
          Keep as draft
        </Button>
        <Button type="submit" disabled={busy} className="min-w-32">
          {pending ? <Spinner /> : null}
          Save as expense
        </Button>
      </FormSheetFooter>
      <ConfirmDialog
        open={confirmDuplicate}
        onOpenChange={setConfirmDuplicate}
        title="This may already be recorded. Save anyway?"
        description={draft.duplicates.join(" ")}
        confirmLabel="Save anyway"
        destructive={false}
        onConfirm={() => {
          void save();
        }}
      />
    </form>
  );
}
