"use client";

import { useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarClock, CreditCard, LineChart, Paperclip, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { Money } from "@/components/shared/money";
import { FileDropzone } from "@/features/files/components/file-dropzone";
import { FileTile } from "@/features/files/components/file-preview";
import { ACCEPT_DOCUMENTS, type FileDTO } from "@/features/files/types";
import { AddSubgroupButton } from "@/features/finance/groups/components/add-subgroup-button";
import type { GroupOption } from "@/features/finance/groups/types";
import { discardUnsavedAssetFile } from "@/features/finance/assets/fixed/actions";
import { applyFieldErrors } from "@/lib/action-result";
import { INVESTMENT_TYPES } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BankAccountOption } from "@/server/lookups";
import { createInvestment, updateInvestment } from "../actions";
import { investmentFormSchema, type InvestmentFormInput, type InvestmentFormValues } from "../schemas";
import type { InvestmentDetail } from "../types";

export const INVESTMENT_ROOT_KEY = "long_term_investments";

const SOURCES = [
  { value: "account", label: "Paid from a bank or cash account", hint: "The money left that account on the purchase date." },
  { value: "opening", label: "Held before the books started", hint: "Carried at cost against opening balances. No account changes." },
] as const;

function defaultsFrom(v?: InvestmentDetail | null, group?: string): InvestmentFormInput {
  return {
    name: v?.name ?? "",
    type: v?.type ?? "fixed_deposit",
    group: v?.group ?? group ?? INVESTMENT_ROOT_KEY,
    institution: v?.institution ?? "",
    reference: v?.reference ?? "",
    purchaseDate: v ? toDateInput(v.purchaseDate) : toDateInput(new Date()),
    amount: v?.amount ?? (undefined as unknown as number),
    source: v && !v.account ? "opening" : "account",
    accountId: v?.account?.id ?? undefined,
    currentValue: v?.currentValue ?? undefined,
    valuedOn: v?.valuedOn ? toDateInput(v.valuedOn) : "",
    interestRate: v?.interestRate ?? undefined,
    maturityDate: v?.maturityDate ? toDateInput(v.maturityDate) : "",
    notes: v?.notes ?? "",
    documentIds: [],
  };
}

/** Create or edit a long-term investment: what it is, what was paid and from where, and what it is worth now. */
export function InvestmentForm({
  investment,
  groups: baseGroups,
  accounts,
  defaultGroup,
  onDone,
  onCancel,
}: {
  investment?: InvestmentDetail | null;
  groups: GroupOption[];
  accounts: BankAccountOption[];
  defaultGroup?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<FileDTO[]>([]);
  // Subgroups added from this form show at once; the page refresh then brings their real name.
  const [added, setAdded] = useState<GroupOption[]>([]);
  const groups = useMemo(() => [...baseGroups, ...added.filter((a) => !baseGroups.some((g) => g.key === a.key))], [baseGroups, added]);
  const form = useForm<InvestmentFormInput, unknown, InvestmentFormValues>({
    resolver: zodResolver(investmentFormSchema),
    defaultValues: defaultsFrom(investment, defaultGroup),
    ...formValidation,
  });
  const { control, setValue, getValues, setError } = form;
  const source = useWatch({ control, name: "source" });
  const amount = useWatch({ control, name: "amount" });
  const currentValue = useWatch({ control, name: "currentValue" });

  const groupOptions = useMemo(() => {
    const minDepth = Math.min(...groups.map((g) => g.depth));
    return groups.map((g) => ({ value: g.key, label: `${"  ".repeat(g.depth - minDepth)}${g.label}`, description: g.builtIn ? undefined : "Subgroup" }));
  }, [groups]);
  const accountOptions = accounts.map((a) => ({ value: a.value, label: a.label, description: a.description }));
  const difference = typeof amount === "number" && typeof currentValue === "number" && Number.isFinite(currentValue) ? round2(currentValue - amount) : null;

  function cancel() {
    for (const f of files) void discardUnsavedAssetFile(f.id);
    onCancel();
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const payload = { ...values, documentIds: files.map((f) => f.id) };
      const result = investment ? await updateInvestment({ ...payload, id: investment.id }) : await createInvestment(payload);
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

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Name" required placeholder="HDFC FD 2026, Nifty index fund" className="sm:col-span-2" />
          <SelectField control={control} name="type" label="Type" required options={INVESTMENT_TYPES} />
          <div className="space-y-2">
            <SelectField control={control} name="group" label="Group" required options={groupOptions} placeholder="Pick a group" />
            <AddSubgroupButton
              parents={groups.filter((g) => !g.archived)}
              defaultParent={getValues("group") || INVESTMENT_ROOT_KEY}
              label="Add subgroup"
              variant="ghost"
              onAdded={(key) => {
                const parent = getValues("group") || INVESTMENT_ROOT_KEY;
                const p = groups.find((g) => g.key === parent);
                setAdded((gs) => [...gs, { key, label: "New subgroup", parent, kind: "asset", builtIn: false, description: null, details: null, archived: false, depth: (p?.depth ?? 0) + 1, path: "" }]);
                setValue("group", key, { shouldDirty: true });
              }}
            />
          </div>
          <TextField control={control} name="institution" label="Institution" placeholder="Bank, AMC, broker" />
          <TextField control={control} name="reference" label="Reference" mono placeholder="FD receipt, folio, certificate no." />
        </div>

        <FormSection title="Purchase" description="What was paid and from where. The balance sheet carries the investment at this cost." icon={<CreditCard />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name="purchaseDate" label="Purchase date" required />
            <NumberField control={control} name="amount" label="Amount invested" currency required />
          </div>
          <Controller
            control={control}
            name="source"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Paid from" className="grid gap-2 sm:grid-cols-2">
                {SOURCES.map((o) => (
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
                    <span className="block font-medium">{o.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
                  </button>
                ))}
              </div>
            )}
          />
          {source === "account" ? (
            <SelectField
              control={control}
              name="accountId"
              label="Paid from"
              required
              options={accountOptions}
              placeholder="Pick an account"
              description={accountOptions.length ? undefined : "No bank or cash accounts are set up yet. Add one on Cash & bank."}
            />
          ) : null}
        </FormSection>

        <FormSection title="Terms" description="Leave empty what does not apply." icon={<CalendarClock />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="interestRate" label="Interest rate" suffix="% a year" step="any" />
            <DateField control={control} name="maturityDate" label="Maturity date" />
          </div>
        </FormSection>

        <FormSection title="Current value" description="What it is worth on a recent date, from a statement or the NAV. Shown beside the cost; the books keep the cost." icon={<LineChart />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="currentValue" label="Current value" currency />
            <DateField control={control} name="valuedOn" label="Valued on" />
          </div>
          {difference !== null ? (
            <p className="text-xs text-muted-foreground">
              {difference >= 0 ? "Above cost by " : "Below cost by "}
              <Money value={Math.abs(difference)} tone={difference >= 0 ? "positive" : "negative"} />
            </p>
          ) : null}
        </FormSection>

        {!investment ? (
          <FormSection title="Documents" description="FD receipt, statement, certificate. More can be added later." icon={<Paperclip />}>
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
          <TextareaField control={control} name="notes" placeholder="Nominee, lock-in, auto-renewal" rows={3} />
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {investment ? "Save changes" : "Add investment"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
