"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { FileText, FolderKanban, Landmark, Paperclip, StickyNote, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { applyFieldErrors } from "@/lib/action-result";
import { INCOME_CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BankAccountOption, ProjectOption } from "@/server/lookups";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_RECEIPTS, type FileDTO } from "@/features/files/types";
import { fetchOpenInvoices } from "@/features/finance/invoices/actions";
import { OVERPAYMENT_FIELD } from "@/features/finance/invoices/schemas";
import type { OpenInvoiceOption } from "@/features/finance/invoices/types";
import { createIncome, discardUnsavedIncomeReceipt, updateIncome } from "../actions";
import { incomeFormSchema, type IncomeFormInput, type IncomeFormValues } from "../schemas";
import type { IncomeDetail } from "../types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { formValidation } from "@/components/forms/form-options";
import { useCan } from "@/components/current-user";

/**
 * How money came in. "On credit" is not money received: an amount still to come goes on an invoice.
 * Records saved with it before keep it when edited (savedOnCredit).
 */
const PAYMENT_OPTIONS = PAYMENT_METHODS.filter((m) => m.value !== "stock" && m.value !== "credit");
const PAYMENT_OPTIONS_WITH_CREDIT = PAYMENT_METHODS.filter((m) => m.value !== "stock");

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
    accountId: income?.account?.id ?? undefined,
    invoiceId: income?.invoice?.id ?? undefined,
  };
}

/**
 * Open invoices of the typed client or picked project, loaded a moment after typing stops. When
 * editing, the receipt's own amount is added back on its invoice (the server does that).
 */
function useOpenInvoices(client: string, projectId: string | undefined, incomeId: string | undefined) {
  const [state, setState] = useState<{ key: string; invoices: OpenInvoiceOption[] }>({ key: "", invoices: [] });
  const key = `${client.trim().toLowerCase()}|${projectId ?? ""}`;
  useEffect(() => {
    if (!client.trim() && !projectId && !incomeId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchOpenInvoices({ client: client.trim() || undefined, projectId, excludeIncomeId: incomeId })
        .then((invoices) => !cancelled && setState({ key, invoices }))
        .catch(() => {
          // Offline: the picker keeps what it had; saving still checks the link on the server.
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, projectId, incomeId, key]);
  return state.key === key ? state.invoices : [];
}

/** Create or edit an income record: payer, amount, how it was received, the invoice it settles and an optional receipt. */
export function IncomeForm({
  income,
  projects,
  clients,
  accounts = [],
  defaultProjectId,
  onDone,
  onCancel,
}: {
  income?: IncomeDetail | null;
  projects: ProjectOption[];
  clients: string[];
  accounts?: BankAccountOption[];
  defaultProjectId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(income);
  const canDelete = useCan("finance.income:delete");
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<FileDTO | null>(income?.receipt ?? null);
  // Confirmations asked before saving: no invoice linked although the client has open ones, or more than is outstanding.
  const [askUnlinked, setAskUnlinked] = useState(false);
  const [overpayment, setOverpayment] = useState<string | null>(null);

  const form = useForm<IncomeFormInput, unknown, IncomeFormValues>({
    resolver: zodResolver(incomeFormSchema),
    defaultValues: defaultsFrom(income, defaultProjectId),
    ...formValidation,
  });
  const { control, setValue, getValues, setError } = form;
  const projectId = useWatch({ control, name: "projectId" });
  const client = useWatch({ control, name: "client" }) ?? "";
  const invoiceId = useWatch({ control, name: "invoiceId" });
  const openInvoices = useOpenInvoices(client, projectId, income?.id);

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

  const savedOnCredit = income?.paymentMethod === "credit";
  const savedAccount = income?.account ?? null;
  const savedInvoice = income?.invoice ?? null;
  const accountOptions = useMemo(() => {
    const list = accounts.map((a) => ({ value: a.value, label: a.label, description: a.description || undefined }));
    // An archived account stays selectable on the record that already uses it.
    if (savedAccount && !list.some((a) => a.value === savedAccount.id)) list.push({ value: savedAccount.id, label: savedAccount.name, description: "Archived" });
    return list;
  }, [accounts, savedAccount]);

  const invoiceOptions = useMemo(() => {
    const list = openInvoices.map((i) => ({
      value: i.id,
      label: `${i.number} · ${formatCurrency(i.outstanding, { exact: true })} outstanding`,
      description: [i.client, `invoiced ${formatDate(i.date)}`, i.dueDate ? `due ${formatDate(i.dueDate)}` : null, i.project?.name].filter(Boolean).join(" · "),
    }));
    // While the list loads (or when the client is changed), the linked invoice keeps its label.
    if (savedInvoice && invoiceId === savedInvoice.id && !list.some((o) => o.value === savedInvoice.id)) {
      list.push({ value: savedInvoice.id, label: savedInvoice.number, description: "Linked invoice" });
    }
    return list;
  }, [openInvoices, savedInvoice, invoiceId]);

  const openTotal = openInvoices.filter((i) => i.id !== invoiceId).reduce((s, i) => s + i.outstanding, 0);
  const showUnlinkedWarning = !invoiceId && openInvoices.some((i) => i.outstanding > 0);

  // Picking a project suggests its client when the client field is still empty.
  function onProjectSelected(value: string | undefined) {
    if (!value || getValues("client")) return;
    const description = projects.find((p) => p.value === value)?.description ?? "";
    const projectClient = description.split(" · ")[1];
    if (projectClient) setValue("client", projectClient, { shouldDirty: true });
  }

  // Picking an invoice fills what is still empty: the amount (its outstanding), the client and the project.
  function onInvoiceSelected(value: string | undefined) {
    const inv = openInvoices.find((i) => i.id === value);
    if (!inv) return;
    if (!getValues("amount") && inv.outstanding > 0) setValue("amount", inv.outstanding, { shouldDirty: true });
    if (!getValues("client")) setValue("client", inv.client, { shouldDirty: true });
    if (!getValues("projectId") && inv.project) setValue("projectId", inv.project.id, { shouldDirty: true });
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

  function save(values: IncomeFormValues) {
    startTransition(async () => {
      const result = income ? await updateIncome({ ...values, id: income.id }) : await createIncome(values);
      if (!result.ok) {
        if (result.fieldErrors?.[OVERPAYMENT_FIELD]) {
          setOverpayment(result.error);
          return;
        }
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone(result.data.id);
    });
  }

  const onSubmit = form.handleSubmit((values) => {
    // Warn once, never block: a receipt may really be unrelated to the open invoices.
    if (showUnlinkedWarning && !values.invoiceId && values.category !== "advance") {
      setAskUnlinked(true);
      return;
    }
    save(values);
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
          <SelectField
            control={control}
            name="paymentMethod"
            label="Payment method"
            required
            options={savedOnCredit ? PAYMENT_OPTIONS_WITH_CREDIT : PAYMENT_OPTIONS}
            description={
              savedOnCredit
                ? "Saved as on credit, which is not money received. Pick how it was paid once it comes in."
                : "Only money already received. An amount not received yet goes on an invoice."
            }
          />
          <TextField
            control={control}
            name="reference"
            label="Reference"
            placeholder="UTR, transaction id or cheque number"
            mono
            className="sm:col-span-2"
          />
        </div>

        <FormSection title="Received into" description="The bank or cash account the money came into." icon={<Landmark />}>
          <ComboboxField
            control={control}
            name="accountId"
            label="Account"
            options={accountOptions}
            placeholder="Default account for the payment method"
            searchPlaceholder="Search accounts…"
            emptyText="No accounts set up yet."
            clearable
          />
          {accounts.length ? null : (
            <p className="text-xs text-muted-foreground">
              No bank or cash accounts are set up yet. An admin can add them under{" "}
              <Link href="/finance/assets/cash" className="underline underline-offset-2">
                Cash &amp; bank
              </Link>
              .
            </p>
          )}
        </FormSection>

        <FormSection
          title="Invoice"
          description="Link the invoice this payment settles. A linked payment reduces what the customer owes and is not counted as revenue a second time."
          icon={<FileText />}
        >
          <ComboboxField
            control={control}
            name="invoiceId"
            label="Settles invoice"
            options={invoiceOptions}
            placeholder={openInvoices.length ? "Not linked to an invoice" : "No open invoices for this client or project"}
            searchPlaceholder="Search invoice numbers…"
            emptyText="No open invoices for this client or project."
            clearable
            onSelected={onInvoiceSelected}
          />
          {showUnlinkedWarning ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
              <span>
                {openInvoices.filter((i) => i.outstanding > 0).length === 1 ? "There is an open invoice" : `There are ${openInvoices.filter((i) => i.outstanding > 0).length} open invoices`} for this
                client or project ({formatCurrency(openTotal, { exact: true })} outstanding). If this payment is for one of them, link it here.
              </span>
            </p>
          ) : null}
        </FormSection>

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
            // Removing the saved receipt deletes the file, which needs the delete permission.
            <FileTile file={receipt} onRemove={canDelete || receipt.id !== income?.receipt?.id ? removeReceipt : undefined} />
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

      <ConfirmDialog
        open={askUnlinked && !pending}
        onOpenChange={(o) => !o && setAskUnlinked(false)}
        title="Save without linking an invoice?"
        description={`This client or project has open invoices (${formatCurrency(openTotal, { exact: true })} outstanding). If this payment settles one of them, cancel and pick it under Invoice, so it is not counted as revenue twice.`}
        confirmLabel="Save without linking"
        destructive={false}
        onConfirm={() => {
          void form.handleSubmit(save)();
        }}
      />
      <ConfirmDialog
        open={overpayment !== null}
        onOpenChange={(o) => !o && setOverpayment(null)}
        title="Record more than is outstanding?"
        description={`${overpayment ?? ""} The extra amount will show as received over the invoice total.`}
        confirmLabel="Record anyway"
        destructive={false}
        onConfirm={() => {
          setValue("allowOverpayment", true);
          void form.handleSubmit(save)();
        }}
      />
    </form>
  );
}
