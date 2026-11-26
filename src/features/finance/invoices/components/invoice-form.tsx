"use client";

import { useMemo, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FolderKanban, ListOrdered, Paperclip, Plus, StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComboboxField, DateField, FormSection, NumberField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { useCan } from "@/components/current-user";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { GSTIN_REGEX, isInterState } from "@/lib/gst";
import type { ProjectOption } from "@/server/lookups";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { ACCEPT_RECEIPTS, type FileDTO } from "@/features/files/types";
import { createInvoice, createInvoiceForReceipt, discardUnsavedInvoiceFile, updateInvoice, type InvoicePrefill } from "../actions";
import { invoiceFormSchema, type InvoiceFormInput, type InvoiceFormValues } from "../schemas";
import { GST_RATES, invoiceTotals } from "../totals";
import type { InvoiceDetail } from "../types";

const EMPTY_LINE = { description: "", quantity: 1, rate: undefined as unknown as number, gstRate: 18, hsnSac: "" };

function defaultsFrom(invoice?: InvoiceDetail | null, receipt?: InvoicePrefill | null): InvoiceFormInput {
  // From a receipt: its customer, project and day, and one empty line whose rate is the amount received
  // (0% GST, so the invoice total equals the receipt). The person fills in the description and can change the rest.
  if (receipt && !invoice) {
    return {
      number: "",
      client: receipt.client,
      clientGstin: "",
      projectId: receipt.projectId ?? undefined,
      date: receipt.date,
      dueDate: "",
      interState: false,
      lines: [{ description: "", quantity: 1, rate: receipt.amount, gstRate: 0, hsnSac: "" }],
      notes: "",
      fileId: undefined,
    };
  }
  return {
    number: invoice?.number ?? "",
    client: invoice?.client ?? "",
    clientGstin: invoice?.clientGstin ?? "",
    projectId: invoice?.project?.id ?? undefined,
    date: invoice ? toDateInput(invoice.date) : toDateInput(new Date()),
    dueDate: invoice?.dueDate ? toDateInput(invoice.dueDate) : "",
    interState: invoice?.interState ?? false,
    lines: invoice?.lines.length
      ? invoice.lines.map((l) => ({ description: l.description, quantity: l.quantity, rate: l.rate, gstRate: l.gstRate, hsnSac: l.hsnSac ?? "" }))
      : [{ ...EMPTY_LINE }],
    notes: invoice?.notes ?? "",
    fileId: invoice?.file?.id ?? undefined,
  };
}

function GstRateField({ control, index }: { control: Control<InvoiceFormInput, unknown, InvoiceFormValues>; index: number }) {
  return (
    <Controller
      control={control}
      name={`lines.${index}.gstRate`}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className="gap-1.5">
          <FieldLabel htmlFor={`lines.${index}.gstRate`} className="text-[13px]">
            GST rate
          </FieldLabel>
          <Select value={String(field.value ?? "")} onValueChange={(v) => field.onChange(Number(v))}>
            <SelectTrigger id={`lines.${index}.gstRate`} ref={field.ref} className="w-full" aria-invalid={fieldState.invalid}>
              <SelectValue placeholder="Rate" />
            </SelectTrigger>
            <SelectContent>
              {GST_RATES.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} className="text-xs" />
        </Field>
      )}
    />
  );
}

/** Create or edit a customer invoice: customer, dates, line items with GST, and the invoice file. */
export function InvoiceForm({
  invoice,
  receipt,
  projects,
  clients,
  onDone,
  onCancel,
}: {
  invoice?: InvoiceDetail | null;
  /** A receipt with no invoice: the invoice is made for it and linked to it when saved. */
  receipt?: InvoicePrefill | null;
  projects: ProjectOption[];
  clients: string[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(invoice);
  const canDelete = useCan("finance.invoices:delete");
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<FileDTO | null>(invoice?.file ?? null);
  // Once the person sets the supply type themselves, a typed GSTIN no longer changes it.
  const [supplyTouched, setSupplyTouched] = useState(isEdit);

  const form = useForm<InvoiceFormInput, unknown, InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: defaultsFrom(invoice, receipt),
    ...formValidation,
  });
  const { control, setValue, getValues, setError } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });
  const interState = useWatch({ control, name: "interState" });
  const totals = invoiceTotals(
    (lines ?? []).map((l) => ({ quantity: Number(l?.quantity) || 0, rate: Number(l?.rate) || 0, gstRate: Number(l?.gstRate) || 0 })),
    Boolean(interState),
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

  function onProjectSelected(value: string | undefined) {
    if (!value || getValues("client")) return;
    const client = (projects.find((p) => p.value === value)?.description ?? "").split(" · ")[1];
    if (client) setValue("client", client, { shouldDirty: true });
  }

  // A customer GSTIN from another state means IGST, unless the person chose otherwise.
  function onGstinChange(value: string) {
    const gstin = value.trim().toUpperCase();
    if (!supplyTouched && GSTIN_REGEX.test(gstin)) setValue("interState", isInterState(gstin), { shouldDirty: true });
  }

  function discardIfUnsaved(fileId: string | undefined) {
    if (fileId && fileId !== invoice?.file?.id) void discardUnsavedInvoiceFile(fileId);
  }

  function setUploaded(next: FileDTO) {
    discardIfUnsaved(getValues("fileId"));
    setFile(next);
    setValue("fileId", next.id, { shouldDirty: true });
  }

  function removeFile() {
    discardIfUnsaved(getValues("fileId"));
    setFile(null);
    setValue("fileId", undefined, { shouldDirty: true });
  }

  function cancel() {
    discardIfUnsaved(getValues("fileId"));
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = invoice
        ? await updateInvoice({ ...values, id: invoice.id })
        : receipt
          ? await createInvoiceForReceipt({ ...values, incomeId: receipt.incomeId })
          : await createInvoice(values);
      if (!result.ok) {
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.number} ${isEdit ? "updated" : "created"}`);
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  const clientError = form.formState.errors.client;
  const linesError = form.formState.errors.lines;

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        {receipt ? (
          <p className="rounded-xl border border-info/25 bg-info/5 px-3.5 py-3 text-sm text-pretty">
            <span className="font-medium">Invoice for receipt {receipt.incomeNumber}.</span>{" "}
            <span className="text-muted-foreground">
              Saving links the receipt to this invoice, so the sale is not counted twice. Add what was sold. The total must be at least the receipt, which is{" "}
              <Money value={receipt.amount} exact />.
            </span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={control}
            name="number"
            label="Invoice number"
            mono
            placeholder={isEdit ? undefined : "Next INV number"}
            description={isEdit ? "Must stay unique" : "Leave empty to use the next number, or type the printed one"}
          />
          <Field data-invalid={clientError ? true : undefined} className="gap-1.5">
            <FieldLabel htmlFor="client" className="text-[13px]">
              <span>
                Customer<span className="ml-0.5 text-danger">*</span>
              </span>
            </FieldLabel>
            <Input
              id="client"
              list="invoice-clients"
              autoComplete="off"
              placeholder="Who is billed"
              aria-invalid={Boolean(clientError)}
              // The customer on the receipt: the invoice must be to the same customer to be linked to it.
              readOnly={Boolean(receipt)}
              {...form.register("client")}
            />
            <datalist id="invoice-clients">
              {clients.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <FieldError errors={clientError ? [clientError] : undefined} className="text-xs" />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="clientGstin" className="text-[13px]">
              Customer GSTIN
            </FieldLabel>
            <Input
              id="clientGstin"
              autoComplete="off"
              placeholder="27AAPFU0939F1ZV"
              className="font-mono uppercase"
              aria-invalid={Boolean(form.formState.errors.clientGstin)}
              {...form.register("clientGstin", { onChange: (e) => onGstinChange(e.target.value) })}
            />
            <FieldError errors={form.formState.errors.clientGstin ? [form.formState.errors.clientGstin] : undefined} className="text-xs" />
          </Field>
          <Controller
            control={control}
            name="interState"
            render={({ field }) => (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="interState" className="text-[13px]">
                  Supply
                </FieldLabel>
                <label className="flex h-9 items-center gap-2.5 text-sm">
                  <Switch
                    id="interState"
                    checked={Boolean(field.value)}
                    onCheckedChange={(v) => {
                      setSupplyTouched(true);
                      field.onChange(v);
                    }}
                  />
                  {field.value ? "Another state (IGST)" : "Within the state (CGST + SGST)"}
                </label>
              </Field>
            )}
          />
          <DateField control={control} name="date" label="Invoice date" required />
          <DateField control={control} name="dueDate" label="Due date" clearable />
        </div>

        <FormSection
          title="Line items"
          description="Amounts are before GST. Totals are worked out again on the server when you save."
          icon={<ListOrdered />}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => append({ ...EMPTY_LINE })} disabled={fields.length >= 100}>
              <Plus /> Add line
            </Button>
          }
        >
          <div className="space-y-3">
            {fields.map((f, i) => (
              <div key={f.id} className="space-y-3 rounded-xl border p-3 sm:p-4">
                <div className="flex items-start gap-2">
                  <TextField control={control} name={`lines.${i}.description`} label={`Line ${i + 1}`} required placeholder="What is billed" className="min-w-0 flex-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-7 text-muted-foreground"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => remove(i)}
                    disabled={fields.length === 1}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <NumberField control={control} name={`lines.${i}.quantity`} label="Quantity" required />
                  <NumberField control={control} name={`lines.${i}.rate`} label="Rate" currency required />
                  <GstRateField control={control} index={i} />
                  <TextField control={control} name={`lines.${i}.hsnSac`} label="HSN/SAC" mono placeholder="998719" />
                </div>
                <p className="flex justify-between text-xs text-muted-foreground">
                  <span>Line amount before GST</span>
                  <Money value={totals.lineAmounts[i] ?? 0} exact className="font-medium text-foreground" />
                </p>
              </div>
            ))}
            {linesError?.message ? <p className="text-xs text-danger">{linesError.message}</p> : null}
            {linesError?.root?.message ? <p className="text-xs text-danger">{linesError.root.message}</p> : null}
          </div>

          <dl className="space-y-1.5 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Taxable value</dt>
              <dd>
                <Money value={totals.taxableAmount} exact />
              </dd>
            </div>
            {interState ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">IGST</dt>
                <dd>
                  <Money value={totals.igst} exact />
                </dd>
              </div>
            ) : (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">CGST</dt>
                  <dd>
                    <Money value={totals.cgst} exact />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">SGST</dt>
                  <dd>
                    <Money value={totals.sgst} exact />
                  </dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold">
              <dt>Invoice total</dt>
              <dd>
                <Money value={totals.total} exact />
              </dd>
            </div>
          </dl>
        </FormSection>

        <FormSection title="Project" description="The project this invoice bills for. It shows on the project's income." icon={<FolderKanban />}>
          <ComboboxField
            control={control}
            name="projectId"
            label="Project"
            options={projectOptions}
            placeholder="Not linked to a project"
            searchPlaceholder="Search projects…"
            clearable
            onSelected={onProjectSelected}
          />
        </FormSection>

        <FormSection title="Invoice file" description={`The invoice as sent, PDF or image up to ${MAX_UPLOAD_LABEL}.`} icon={<Paperclip />}>
          {file ? (
            // Removing a saved file deletes it, which needs the delete permission.
            <FileTile file={file} onRemove={canDelete || file.id !== invoice?.file?.id ? removeFile : undefined} />
          ) : (
            <FileDropzone
              meta={{ kind: "attachment" }}
              accept={ACCEPT_RECEIPTS}
              multiple={false}
              compact
              title="Drop the invoice or click to browse"
              hint="PDF, PNG, JPEG or WebP"
              onUploaded={setUploaded}
            />
          )}
        </FormSection>

        <FormSection title="Notes" icon={<StickyNote />}>
          <TextareaField control={control} name="notes" placeholder="Payment terms, PO reference, anything the accountant should know" rows={3} />
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {isEdit ? "Save changes" : "Create invoice"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
