"use client";

import { useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Landmark, Route, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField, FormSection, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { BANK_ACCOUNT_KINDS } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { createBankAccount, updateBankAccount } from "../actions";
import { DEFAULT_FOR_OPTIONS, bankAccountFormSchema, type BankAccountFormInput, type BankAccountFormValues } from "../schemas";
import type { BankAccountDetail } from "../types";

function defaultsFrom(account?: BankAccountDetail | null): BankAccountFormInput {
  return {
    name: account?.name ?? "",
    kind: account?.kind ?? "bank",
    bankName: account?.bankName ?? "",
    accountLast4: account?.accountLast4 ?? "",
    ifsc: account?.ifsc ?? "",
    openingBalance: account?.openingBalance ?? 0,
    openingDate: account?.openingDate ?? toDateInput(new Date()),
    defaultFor: account?.defaultFor ?? [],
    notes: account?.notes ?? "",
  };
}

/**
 * Add or edit a bank account or cash box. `takenDefaults` maps each payment method that another
 * account is the default for to that account's name, so the choice is shown before saving.
 */
export function AccountForm({
  account,
  takenDefaults,
  onDone,
  onCancel,
}: {
  account?: BankAccountDetail | null;
  takenDefaults: Record<string, string>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<BankAccountFormInput, unknown, BankAccountFormValues>({
    resolver: zodResolver(bankAccountFormSchema),
    defaultValues: defaultsFrom(account),
    ...formValidation,
  });
  const { control, setError } = form;
  const kind = useWatch({ control, name: "kind" });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = account ? await updateBankAccount({ ...values, id: account.id }) : await createBankAccount(values);
      if (!result.ok) {
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved");
      emitDataChanged();
      onDone();
    }),
  );

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="name" label="Name" required placeholder={kind === "cash" ? "Office cash box" : "HDFC current account"} className="sm:col-span-2" />
          <SelectField control={control} name="kind" label="Type" required options={BANK_ACCOUNT_KINDS} />
          {kind === "bank" ? <TextField control={control} name="bankName" label="Bank" placeholder="HDFC Bank" /> : <div className="max-sm:hidden" />}
          {kind === "bank" ? (
            <>
              <TextField
                control={control}
                name="accountLast4"
                label="Account number, last 4 digits"
                placeholder="1234"
                mono
                description="Only the last four digits are kept."
              />
              <TextField control={control} name="ifsc" label="IFSC" placeholder="HDFC0001234" mono transform={(v) => v.toUpperCase()} />
            </>
          ) : null}
        </div>

        <FormSection
          title="Opening balance"
          description="What the account held at the start of its opening date. Records dated before that day are already part of this balance, so they do not change it."
          icon={<Landmark />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="openingBalance" label="Opening balance" currency allowNegative required description="Negative for an overdraft." />
            <DateField control={control} name="openingDate" label="Opening date" required />
          </div>
        </FormSection>

        <FormSection
          title="Default for"
          description="Records paid or received this way that name no account land here. Each method can be the default of one account."
          icon={<Route />}
        >
          <Controller
            control={control}
            name="defaultFor"
            render={({ field, fieldState }) => {
              const value = field.value ?? [];
              return (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DEFAULT_FOR_OPTIONS.map((o) => {
                      const owner = takenDefaults[o.value];
                      const checked = value.includes(o.value);
                      return (
                        <label
                          key={o.value}
                          className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                        >
                          <Checkbox
                            checked={checked}
                            disabled={Boolean(owner) && !checked}
                            onCheckedChange={(on) => field.onChange(on ? [...value, o.value] : value.filter((v) => v !== o.value))}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">{o.label}</span>
                            {owner && !checked ? <span className="block text-xs text-muted-foreground">Default for {owner}</span> : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {fieldState.error?.message ? <p className="text-xs text-danger">{fieldState.error.message}</p> : null}
                </div>
              );
            }}
          />
        </FormSection>

        <FormSection title="Notes" icon={<StickyNote />}>
          <TextareaField control={control} name="notes" label="Notes" placeholder="Branch, who holds the cash box, anything worth keeping" />
        </FormSection>
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : null}
          {account ? "Save changes" : "Add account"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
