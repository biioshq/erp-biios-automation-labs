"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FolderKanban, Paperclip, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { applyFieldErrors } from "@/lib/action-result";
import { INCOME_CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import type { ProjectOption } from "@/server/lookups";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_RECEIPTS, type FileDTO } from "@/features/files/types";
import { createIncome, discardUnsavedIncomeReceipt, updateIncome } from "../actions";
import { incomeFormSchema, type IncomeFormInput, type IncomeFormValues } from "../schemas";
import type { IncomeDetail } from "../types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { formValidation } from "@/components/forms/form-options";
import { useIsAdmin } from "@/components/current-user";

const PAYMENT_OPTIONS = PAYMENT_METHODS.filter((m) => m.value !== "stock");

function defaultsFrom(income?: IncomeDetail | null, projectId?: string): IncomeFormInput {
  return {
    client: income?.client ?? "",
    projectId: income?.project?.id ?? projectId ?? undefined,
    category: income?.category ?? "project_payment",
    amount: income?.amount ?? (undefined as unknown as number),
    date: income ? toDateInput(income.date) : toDateInput(new Date()),
    paymentMethod: income?.paymentMethod ?? "bank_transfer",
    reference: income?.reference ?? "",
    notes: income?.notes ?? "",
    receiptId: income?.receipt?.id ?? undefined,
  };
}

/** Create or edit an income record: payer, amount, how it was received, and an optional receipt. */
export function IncomeForm({
  income,
  projects,
  clients,
  defaultProjectId,
  onDone,
  onCancel,
}: {
  income?: IncomeDetail | null;
  projects: ProjectOption[];
  clients: string[];
  defaultProjectId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(income);
  const isAdmin = useIsAdmin();
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<FileDTO | null>(income?.receipt ?? null);

  const form = useForm<IncomeFormInput, unknown, IncomeFormValues>({
    resolver: zodResolver(incomeFormSchema),
    defaultValues: defaultsFrom(income, defaultProjectId),
    ...formValidation,
  });
  const { control, setValue, getValues, setError } = form;
  const projectId = useWatch({ control, name: "projectId" });

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

  // Picking a project suggests its client when the client field is still empty.
  function onProjectSelected(value: string | undefined) {
    if (!value || getValues("client")) return;
    const description = projects.find((p) => p.value === value)?.description ?? "";
    const client = description.split(" · ")[1];
    if (client) setValue("client", client, { shouldDirty: true });
  }

  /** A receipt that was uploaded in this form but never saved is deleted again. */
  function discardIfUnsaved(fileId: string | undefined) {
    if (fileId && fileId !== income?.receipt?.id) void discardUnsavedIncomeReceipt(fileId);
  }

  function setUploaded(file: FileDTO) {
    discardIfUnsaved(getValues("receiptId"));
    setReceipt(file);
    setValue("receiptId", file.id, { shouldDirty: true });
  }

  function removeReceipt() {
    discardIfUnsaved(getValues("receiptId"));
    setReceipt(null);
    setValue("receiptId", undefined, { shouldDirty: true });
  }

  function cancel() {
    discardIfUnsaved(getValues("receiptId"));
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = income ? await updateIncome({ ...values, id: income.id }) : await createIncome(values);
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

  const clientError = form.formState.errors.client;

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={clientError ? true : undefined} className="gap-1.5 sm:col-span-2">
            <FieldLabel htmlFor="client" className="text-[13px]">
              <span>
                Client<span className="ml-0.5 text-danger">*</span>
              </span>
            </FieldLabel>
            <Input
              id="client"
              list="income-clients"
              autoComplete="off"
              placeholder="Who paid you"
              aria-invalid={Boolean(clientError)}
              {...form.register("client")}
            />
            <datalist id="income-clients">
              {clients.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <FieldError errors={clientError ? [clientError] : undefined} className="text-xs" />
          </Field>
          <NumberField control={control} name="amount" label="Amount received" currency required description="Total received in rupees" />
          <DateField control={control} name="date" label="Date received" required />
          <SelectField control={control} name="category" label="Category" required options={INCOME_CATEGORIES} />
          <SelectField control={control} name="paymentMethod" label="Payment method" required options={PAYMENT_OPTIONS} />
          <TextField
            control={control}
            name="reference"
            label="Reference"
            placeholder="UTR, transaction id or cheque number"
            mono
            className="sm:col-span-2"
          />
        </div>

        <FormSection title="Project" description="Link the payment to a project to track what the client has paid against its budget." icon={<FolderKanban />}>
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
          {projectId ? null : <p className="text-xs text-muted-foreground">Leave empty for income that is not tied to one project.</p>}
        </FormSection>

        <FormSection title="Receipt" description={`Payment advice, bank credit or acknowledgement. Image or PDF up to ${MAX_UPLOAD_LABEL}.`} icon={<Paperclip />}>
          {receipt ? (
            // Removing the saved receipt deletes the file, which only admins may do.
            <FileTile file={receipt} onRemove={isAdmin || receipt.id !== income?.receipt?.id ? removeReceipt : undefined} />
          ) : (
            <FileDropzone
              meta={{ kind: "receipt", entityType: "income" }}
              accept={ACCEPT_RECEIPTS}
              multiple={false}
              compact
              title="Drop a receipt or click to browse"
              hint="PNG, JPEG, WebP or PDF"
              onUploaded={setUploaded}
            />
          )}
        </FormSection>

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
          {isEdit ? "Save changes" : "Record income"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
