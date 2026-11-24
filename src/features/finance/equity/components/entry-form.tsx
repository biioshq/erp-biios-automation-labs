"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Landmark, Paperclip, StickyNote, UserPlus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ComboboxField, DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { EQUITY_HOLDER_KINDS, INVESTOR_INSTRUMENTS, type CapitalEntryType, type EquityHolderKind } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import type { BankAccountOption } from "@/server/lookups";
import type { GroupOption } from "@/features/finance/groups/types";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, type FileDTO } from "@/features/files/types";
import { MAX_UPLOAD_LABEL } from "@/features/files/prepare";
import { discardUnsavedEquityDocument, recordEntry, updateEntry } from "../actions";
import { entryFormSchema, type EntryFormInput, type EntryFormValues } from "../schemas";
import { EQUITY_PAYMENT_METHODS, NEW_ENTRY_TITLES, isMoneyEntry } from "../labels";
import type { EntryDetail, HolderOption } from "../types";

const CONTRIBUTIONS = [
  { value: "auto", label: "Decide from earlier entries" },
  { value: "initial", label: "Initial capital" },
  { value: "additional", label: "Additional capital" },
];

function defaultsFrom(
  type: CapitalEntryType,
  entry: EntryDetail | null | undefined,
  holderId: string | undefined,
  kind: EquityHolderKind,
  defaultDate: string | undefined,
): EntryFormInput {
  return {
    type: entry?.type ?? type,
    holderId: entry?.holder?.id ?? holderId ?? undefined,
    newHolderName: "",
    newHolderKind: kind,
    date: entry ? toDateInput(entry.date) : (defaultDate ?? toDateInput(new Date())),
    amount: entry?.amount ?? (undefined as unknown as number),
    paymentMethod: entry?.paymentMethod ?? (isMoneyEntry(entry?.type ?? type) ? "bank_transfer" : undefined),
    accountId: entry?.account?.id ?? undefined,
    reference: entry?.reference ?? "",
    purpose: entry?.purpose ?? "",
    notes: entry?.notes ?? "",
    contribution: entry?.initial === true ? "initial" : entry?.initial === false ? "additional" : "auto",
    instrument: entry?.instrument ?? undefined,
    reserveGroup: entry?.reserveGroup?.key ?? undefined,
    documentIds: entry?.files.map((f) => f.id) ?? [],
  };
}

/** Create or edit any capital entry. The fields shown depend on the entry type. */
export function EntryForm({
  type,
  entry,
  holderId,
  defaultKind = "owner",
  defaultDate,
  holders,
  accounts,
  reserveGroups,
  reserveParents,
  onDone,
  onCancel,
}: {
  type: CapitalEntryType;
  /** The role a person typed in as new gets by default. */
  defaultKind?: EquityHolderKind;
  /** Date a new entry starts with (today when not given). */
  defaultDate?: string;
  entry?: EntryDetail | null;
  holderId?: string;
  holders: HolderOption[];
  accounts: BankAccountOption[];
  reserveGroups: GroupOption[];
  reserveParents: GroupOption[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const kind = entry?.type ?? type;
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileDTO[]>(entry?.files ?? []);
  const [addingPerson, setAddingPerson] = useState(false);
  const form = useForm<EntryFormInput, unknown, EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: defaultsFrom(kind, entry, holderId, defaultKind, defaultDate),
    ...formValidation,
  });
  const { control, setValue, getValues, setError } = form;
  const selectedHolder = useWatch({ control, name: "holderId" });
  const method = useWatch({ control, name: "paymentMethod" });
  const newKind = useWatch({ control, name: "newHolderKind" });

  const holderOptions = useMemo(() => {
    const allowed = holders.filter((h) => (kind === "drawing" ? h.kind === "owner" : true));
    return allowed
      .filter((h) => !h.archived || h.value === entry?.holder?.id)
      .map((h) => ({
        value: h.value,
        label: h.label,
        description: `${h.kind === "owner" ? "Owner" : "Investor"}${h.archived ? " · archived" : ""}`,
      }));
  }, [holders, kind, entry?.holder?.id]);

  const holder = holders.find((h) => h.value === selectedHolder);
  const isInvestor = addingPerson ? newKind === "investor" : holder?.kind === "investor";

  // Cash goes to a cash box, everything else to a bank account; the group company has no account here.
  const accountOptions = useMemo(() => {
    const open = accounts
      .filter((a) => (method === "cash" ? a.kind === "cash" : a.kind === "bank"))
      .map((a) => ({ value: a.value, label: a.label, description: a.description }));
    // The account a saved entry already uses stays selectable after it is closed, so editing never drops it.
    const saved = entry?.account;
    if (saved && !accounts.some((a) => a.value === saved.id)) open.push({ value: saved.id, label: `${saved.name} (closed)`, description: "" });
    return open;
  }, [accounts, method, entry?.account]);
  const showAccount = isMoneyEntry(kind) && method !== "biios_startup_llp";

  // A cash box picked for a bank payment (or the other way round) is cleared when the mode changes.
  // Only on a change of mode: a saved entry opens with exactly what it has.
  const lastMethod = useRef(method);
  useEffect(() => {
    if (lastMethod.current === method) return;
    lastMethod.current = method;
    const current = getValues("accountId");
    if (current && !accountOptions.some((a) => a.value === current)) setValue("accountId", undefined, { shouldDirty: true });
  }, [method, accountOptions, getValues, setValue]);

  function onHolderSelected(value: string | undefined) {
    const picked = holders.find((h) => h.value === value);
    if (picked?.kind === "investor" && picked.instrument && !getValues("instrument")) setValue("instrument", picked.instrument, { shouldDirty: true });
  }

  // Only one of the two is sent: a picked person, or a new name.
  function togglePerson() {
    if (addingPerson) setValue("newHolderName", "");
    else setValue("holderId", undefined);
    form.clearErrors(["holderId", "newHolderName"]);
    setAddingPerson(!addingPerson);
  }

  function discard(fileId: string) {
    if (!entry?.files.some((f) => f.id === fileId)) void discardUnsavedEquityDocument(fileId);
  }

  function addFile(file: FileDTO) {
    setFiles((list) => [...list, file]);
    setValue("documentIds", [...(getValues("documentIds") ?? []), file.id], { shouldDirty: true });
  }

  function removeFile(fileId: string) {
    discard(fileId);
    setFiles((list) => list.filter((f) => f.id !== fileId));
    setValue(
      "documentIds",
      (getValues("documentIds") ?? []).filter((id) => id !== fileId),
      { shouldDirty: true },
    );
  }

  function cancel() {
    for (const f of files) discard(f.id);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    const payload = addingPerson ? { ...values, holderId: undefined } : { ...values, newHolderName: undefined };
    startTransition(async () => {
      const result = entry ? await updateEntry({ ...payload, id: entry.id }) : await recordEntry(payload);
      if (!result.ok) {
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(entry ? "Entry saved" : `${"number" in result.data ? result.data.number : "Entry"} recorded`);
      emitDataChanged();
      onDone(result.data.id);
    });
  });

  const amountLabel =
    kind === "capital" ? "Amount introduced" : kind === "drawing" ? "Amount withdrawn" : kind === "dividend" ? "Amount paid out" : kind === "reserve_transfer" ? "Amount set aside" : "Retained earnings";

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        {kind === "capital" || kind === "drawing" || kind === "dividend" ? (
          <div className="space-y-3">
            {addingPerson ? (
              <div className="grid gap-4 rounded-xl border bg-surface p-4 sm:grid-cols-2">
                <TextField control={control} name="newHolderName" label={kind === "drawing" ? "Owner's name" : "Name"} required placeholder="Full name or firm" />
                {kind === "drawing" ? null : <SelectField control={control} name="newHolderKind" label="Role" required options={EQUITY_HOLDER_KINDS} />}
                <p className="text-xs text-muted-foreground sm:col-span-2">They are added to the {kind === "drawing" || newKind !== "investor" ? "owners" : "investors"} list with this entry. Add contact details and ownership later from their record.</p>
              </div>
            ) : (
              <ComboboxField
                control={control}
                name="holderId"
                label={kind === "drawing" ? "Owner" : kind === "dividend" ? "Paid to" : "Owner or investor"}
                required={kind !== "dividend"}
                options={holderOptions}
                placeholder={kind === "dividend" ? "All shareholders, or pick one" : "Pick who"}
                searchPlaceholder="Search names…"
                emptyText="Nobody listed yet."
                clearable={kind === "dividend"}
                onSelected={onHolderSelected}
              />
            )}
            {entry ? null : (
              <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => togglePerson()}>
                <UserPlus /> {addingPerson ? "Pick someone already listed" : kind === "drawing" ? "Owner not listed yet" : "Someone not listed yet"}
              </Button>
            )}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            control={control}
            name="amount"
            label={amountLabel}
            currency
            required
            allowNegative={kind === "opening_retained"}
            description={kind === "opening_retained" ? "Negative for accumulated losses" : undefined}
          />
          <DateField
            control={control}
            name="date"
            label={kind === "opening_retained" ? "As of" : "Date"}
            required
            description={kind === "opening_retained" ? "The day before the first records in this ERP" : undefined}
          />
          {kind === "capital" ? <SelectField control={control} name="contribution" label="Contribution" options={CONTRIBUTIONS} /> : null}
          {kind === "capital" && isInvestor ? <SelectField control={control} name="instrument" label="Investment type" options={INVESTOR_INSTRUMENTS} clearable /> : null}
          {kind === "reserve_transfer" ? (
            <div className="space-y-2 sm:col-span-2">
              <SelectField
                control={control}
                name="reserveGroup"
                label="Reserve"
                required
                options={reserveGroups.map((g) => ({ value: g.key, label: `${"  ".repeat(Math.max(0, g.depth - 1))}${g.label}` }))}
              />
              <AddSubgroupButton
                parents={reserveParents}
                defaultParent="reserves_surplus"
                label="Add reserve type"
                variant="ghost"
                onAdded={(key) => setValue("reserveGroup", key, { shouldDirty: true, shouldValidate: true })}
              />
            </div>
          ) : null}
        </div>

        {isMoneyEntry(kind) ? (
          <FormSection title="Payment" description={kind === "capital" ? "How the money came in and where it landed." : "How the money was paid and which account it left."} icon={<Wallet />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={control} name="paymentMethod" label="Payment mode" required options={EQUITY_PAYMENT_METHODS} />
              {showAccount ? (
                <SelectField
                  control={control}
                  name="accountId"
                  label={kind === "capital" ? "Received into" : "Paid from"}
                  options={accountOptions}
                  placeholder={accountOptions.length ? "Default account for this mode" : "No account set up"}
                  clearable
                  description={accountOptions.length ? undefined : "Set up accounts on Cash & bank. Until then it counts in the unassigned account."}
                />
              ) : (
                <p className="self-end pb-2 text-xs text-muted-foreground">Counted against what is owed to Biios Startup LLP.</p>
              )}
              <TextField control={control} name="reference" label="Transaction reference" placeholder="UTR, cheque number or receipt" mono className="sm:col-span-2" />
            </div>
          </FormSection>
        ) : (
          <TextField control={control} name="reference" label="Reference" placeholder="Board resolution, journal or note number" mono />
        )}

        {kind === "drawing" || kind === "dividend" || kind === "reserve_transfer" ? (
          <TextField
            control={control}
            name="purpose"
            label={kind === "drawing" ? "Purpose" : "Reason"}
            placeholder={kind === "drawing" ? "Personal expenses, tax payment…" : kind === "dividend" ? "Interim dividend for the year" : "Policy or board decision"}
          />
        ) : null}

        <FormSection title="Supporting documents" description={`Bank advice, agreement, share certificate or resolution. Up to ${MAX_UPLOAD_LABEL} each.`} icon={<Paperclip />}>
          <div className="space-y-2">
            {files.map((f) => (
              <FileTile key={f.id} file={f} onRemove={() => removeFile(f.id)} />
            ))}
            <FileDropzone meta={{ kind: "document" }} accept={ACCEPT_DOCUMENTS} compact title="Drop documents or click to browse" hint="PDF, images, spreadsheets, Word" onUploaded={addFile} />
          </div>
        </FormSection>

        <FormSection title="Notes" icon={<StickyNote />}>
          <TextareaField control={control} name="notes" placeholder="Anything the accountant should know" rows={3} />
        </FormSection>

        {kind === "opening_retained" ? (
          <p className="flex gap-2 rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
            <Landmark className="mt-0.5 size-4 shrink-0" />
            This is the figure from the last balance sheet before this ERP. It moves value inside equity (from opening balances to retained earnings) and is not income.
          </p>
        ) : null}
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {entry ? "Save changes" : NEW_ENTRY_TITLES[kind].submit}
        </Button>
      </FormSheetFooter>
    </form>
  );
}

