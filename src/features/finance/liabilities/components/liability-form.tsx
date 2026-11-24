"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarClock, Landmark, Paperclip, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { LIABILITY_KINDS, LIABILITY_SOURCES, type LiabilityKind, type LiabilitySource } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, type FileDTO } from "@/features/files/types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { createLiabilityAction, discardUnsavedLiabilityDocument, updateLiabilityAction } from "../actions";
import { liabilityFormSchema, REPAYMENT_METHODS, type LiabilityFormInput, type LiabilityFormValues } from "../schemas";
import { recordGroupOptions, type LiabilitySide } from "../groups";
import { suggestedEmi } from "../schedule";
import type { LiabilityDetail } from "../types";

const defaultSource = (kind: LiabilityKind): LiabilitySource => (kind === "loan" ? "account" : "opening");

function defaultsFrom(l: LiabilityDetail | null | undefined, kind: LiabilityKind, group: string | undefined): LiabilityFormInput {
  return {
    name: l?.name ?? "",
    kind: l?.kind ?? kind,
    group: l?.group ?? group ?? "",
    lender: l?.lender ?? "",
    originalAmount: l?.originalAmount ?? (undefined as unknown as number),
    date: l?.date ?? toDateInput(new Date()),
    dueDate: l?.dueDate ?? undefined,
    interestRate: l?.interestRate ?? undefined,
    tenureMonths: l?.tenureMonths ?? undefined,
    installment: l?.installment ?? undefined,
    // "Received into an account" adds the amount to that account's balance. True for a loan, rarely for
    // TDS or salaries due, so other obligations start at "Owed before the books started".
    sourceMode: l?.source.mode ?? defaultSource(kind),
    accountId: l?.source.accountId ?? undefined,
    paymentMethod: l?.source.paymentMethod && l.source.paymentMethod !== "credit" && l.source.paymentMethod !== "stock" ? l.source.paymentMethod : "bank_transfer",
    category: l?.source.category ?? undefined,
    reference: l?.reference ?? "",
    notes: l?.notes ?? "",
    documentIds: [],
  };
}

/** Add or edit a loan or another obligation. Repayments are recorded from the detail view, never here. */
export function LiabilityForm({
  liability,
  groups,
  accounts,
  lenders,
  defaultKind,
  defaultGroup,
  side,
  categories = [],
  onDone,
  onCancel,
}: {
  liability?: LiabilityDetail | null;
  groups: GroupOption[];
  accounts: BankAccountOption[];
  lenders: string[];
  /** Expense categories an accrued obligation can be booked to. Without them the accrued source is not offered. */
  categories?: { value: string; label: string }[];
  defaultKind: LiabilityKind;
  defaultGroup?: string;
  /** Only offer groups on this side (the Current and Non-current pages). */
  side?: LiabilitySide;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [uploads, setUploads] = useState<FileDTO[]>([]);
  const form = useForm<LiabilityFormInput, unknown, LiabilityFormValues>({
    resolver: zodResolver(liabilityFormSchema),
    defaultValues: defaultsFrom(liability, defaultKind, defaultGroup),
    ...formValidation,
  });
  const { control, setValue, getValues, setError } = form;
  const kind = useWatch({ control, name: "kind" });
  const sourceMode = useWatch({ control, name: "sourceMode" });
  const [amount, rate, tenure] = useWatch({ control, name: ["originalAmount", "interestRate", "tenureMonths"] });

  const groupOptions = useMemo(() => {
    const options = recordGroupOptions(groups, kind, side);
    // A record filed under a group that no longer takes records keeps it until it is moved.
    const current = liability?.group;
    if (current && !options.some((o) => o.value === current)) {
      options.unshift({ value: current, label: liability?.groupLabel ?? current, description: liability?.groupPath ?? "" });
    }
    return options.map((o) => ({ value: o.value, label: o.description || o.label }));
  }, [groups, kind, side, liability]);

  // Loans are received into an account or owed from before the books; only other obligations can be an expense not paid yet.
  const sourceOptions = useMemo(
    () => LIABILITY_SOURCES.filter((o) => o.value !== "accrued" || (kind !== "loan" && (categories.length > 0 || liability?.source.mode === "accrued"))),
    [kind, categories, liability],
  );
  const categoryOptions = useMemo(() => {
    const options = [...categories];
    // A record booked to a category that is hidden since keeps it.
    const current = liability?.source.category;
    if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: liability?.source.categoryLabel ?? current });
    return options;
  }, [categories, liability]);

  const accountOptions = useMemo(() => accounts.map((a) => ({ value: a.value, label: a.description ? `${a.label} · ${a.description}` : a.label })), [accounts]);
  const emi = kind === "loan" && typeof amount === "number" && typeof rate === "number" && typeof tenure === "number" ? suggestedEmi(amount, rate, tenure) : null;

  // The group list depends on the kind: a group the new kind cannot use is cleared.
  useEffect(() => {
    if (getValues("group") && !groupOptions.some((o) => o.value === getValues("group"))) setValue("group", "");
  }, [groupOptions, getValues, setValue]);

  // On a new record, switching the kind moves the source to that kind's default unless it was picked by hand.
  const sourceTouched = form.formState.dirtyFields.sourceMode;
  useEffect(() => {
    if (!liability && !sourceTouched) setValue("sourceMode", defaultSource(kind));
  }, [kind, liability, sourceTouched, setValue]);

  // A loan is never an expense: switching to a loan moves "An expense not paid yet" to "Received into an account".
  useEffect(() => {
    if (kind === "loan" && getValues("sourceMode") === "accrued") setValue("sourceMode", "account", { shouldDirty: true });
  }, [kind, getValues, setValue]);

  function discard(fileId: string) {
    void discardUnsavedLiabilityDocument(fileId);
    setUploads((u) => u.filter((f) => f.id !== fileId));
  }

  function cancel() {
    for (const f of uploads) void discardUnsavedLiabilityDocument(f.id);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload = { ...values, documentIds: uploads.map((f) => f.id) };
      const result = liability ? await updateLiabilityAction({ ...payload, id: liability.id }) : await createLiabilityAction(payload);
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

  const lenderError = form.formState.errors.lender;
  const isLoan = kind === "loan";

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={control} name="kind" label="What it is" required options={LIABILITY_KINDS} className="sm:col-span-2" />
          <TextField control={control} name="name" label="Name" required placeholder={isLoan ? "HDFC term loan" : "TDS payable, October"} className="sm:col-span-2" />
          <Field data-invalid={lenderError ? true : undefined} className="gap-1.5 sm:col-span-2">
            <FieldLabel htmlFor="lender" className="text-[13px]">
              <span>
                {isLoan ? "Lender" : "Owed to"}
                <span className="ml-0.5 text-danger">*</span>
              </span>
            </FieldLabel>
            <Input id="lender" list="liability-lenders" autoComplete="off" placeholder={isLoan ? "Bank, NBFC or person" : "Supplier, authority or person"} aria-invalid={Boolean(lenderError)} {...form.register("lender")} />
            <datalist id="liability-lenders">
              {lenders.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <FieldError errors={lenderError ? [lenderError] : undefined} className="text-xs" />
          </Field>
          <SelectField
            control={control}
            name="group"
            label="Group"
            required
            options={groupOptions}
            placeholder={groupOptions.length ? "Pick a group" : "No group takes this kind"}
            className="sm:col-span-2"
          />
          <NumberField control={control} name="originalAmount" label={isLoan ? "Loan amount" : "Amount owed"} currency required />
          <NumberField control={control} name="interestRate" label="Interest rate" suffix="% a year" step="any" description={isLoan ? undefined : "Only if it carries interest"} />
          <DateField control={control} name="date" label={isLoan ? "Date taken" : "Date it arose"} required />
          <DateField control={control} name="dueDate" label={isLoan ? "Final due date" : "Due date"} clearable />
        </div>

        {isLoan ? (
          <FormSection title="Repayment terms" description="With the rate, tenure and instalment the loan page shows the planned EMI schedule. It is worked out from these terms each time and never stored." icon={<CalendarClock />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField control={control} name="tenureMonths" label="Tenure" suffix="months" step={1} />
              <NumberField control={control} name="installment" label="Monthly instalment" currency />
            </div>
            {emi ? (
              <p className="text-xs text-muted-foreground">
                At this rate and tenure the usual EMI is <span className="tabular font-medium text-foreground">{formatCurrency(emi, { exact: true })}</span>.{" "}
                <button type="button" className="font-medium text-brand-ink hover:underline" onClick={() => setValue("installment", emi, { shouldDirty: true })}>
                  Use it
                </button>
              </p>
            ) : null}
          </FormSection>
        ) : null}

        <FormSection
          title={isLoan ? "Where the money went" : "How it is recorded"}
          description={
            isLoan
              ? "The loan amount came into a bank or cash account, or it was owed before the books in this ERP started."
              : "An expense not paid yet books the cost in the expense category you pick, on the date it arose: use it for salaries, TDS or rent due. Owed before the books started is for amounts from before the records in this ERP. Received into an account adds the amount to that account's balance, so pick it only when money actually came in."
          }
          icon={<Landmark />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField control={control} name="sourceMode" label="Source" required options={sourceOptions} className="sm:col-span-2" />
            {sourceMode === "accrued" ? (
              <SelectField
                control={control}
                name="category"
                label="Expense category"
                required
                options={categoryOptions}
                placeholder="Pick a category"
                description="Use this when the cost belongs to this period and is not paid yet. Do not also record it in Expenses."
                className="sm:col-span-2"
              />
            ) : null}
            {sourceMode === "account" ? (
              <>
                <SelectField control={control} name="accountId" label="Received into" options={accountOptions} placeholder="Default account for the method" clearable />
                <SelectField control={control} name="paymentMethod" label="Method" options={REPAYMENT_METHODS} />
              </>
            ) : null}
          </div>
          <TextField control={control} name="reference" label="Reference" placeholder="Loan account number, sanction letter, challan" mono />
        </FormSection>

        <FormSection title="Documents" description={`Sanction letter, agreement, statements. Up to ${MAX_UPLOAD_LABEL} each. Saved documents are managed from the detail view.`} icon={<Paperclip />}>
          {uploads.length ? (
            <div className="space-y-2">
              {uploads.map((f) => (
                <FileTile key={f.id} file={f} onRemove={() => discard(f.id)} />
              ))}
            </div>
          ) : null}
          <FileDropzone
            meta={{ kind: "document" }}
            accept={ACCEPT_DOCUMENTS}
            compact
            title="Drop documents or click to browse"
            hint="PDF, images, Word, Excel"
            onUploaded={(file) => setUploads((u) => [...u, file])}
          />
        </FormSection>

        <FormSection title="Notes" icon={<StickyNote />}>
          <TextareaField control={control} name="notes" placeholder="Security given, prepayment terms, anything the accountant should know" rows={3} />
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {liability ? "Save changes" : isLoan ? "Add loan" : "Add liability"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}

