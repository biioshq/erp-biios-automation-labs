"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { FormSheetBody, FormSheetFooter } from "@/components/shared/form-sheet";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { EQUITY_HOLDER_KINDS, INVESTOR_INSTRUMENTS, type EquityHolderKind } from "@/lib/constants";
import { emitDataChanged } from "@/lib/events";
import { createHolder, updateHolder } from "../actions";
import { holderFormSchema, type HolderFormInput, type HolderFormValues } from "../schemas";
import type { HolderDetail } from "../types";

/** Add or edit an owner or investor. Their money is recorded as capital entries, not here. */
export function HolderForm({
  holder,
  defaultKind = "owner",
  onDone,
  onCancel,
}: {
  holder?: HolderDetail | null;
  defaultKind?: EquityHolderKind;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<HolderFormInput, unknown, HolderFormValues>({
    resolver: zodResolver(holderFormSchema),
    defaultValues: {
      name: holder?.name ?? "",
      kind: holder?.kind ?? defaultKind,
      ownershipPercent: holder?.ownershipPercent ?? undefined,
      instrument: holder?.instrument ?? undefined,
      email: holder?.email ?? "",
      phone: holder?.phone ?? "",
      notes: holder?.notes ?? "",
    },
    ...formValidation,
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  // Once someone has entries their role is fixed: their capital is filed under it.
  const kindLocked = Boolean(holder && holder.entries > 0);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = holder ? await updateHolder({ ...values, id: holder.id }) : await createHolder(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(holder ? "Saved" : `${values.name} added`);
      emitDataChanged();
      onDone(result.data.id);
    }),
  );

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <FormSheetBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="name" label="Name" required placeholder="Full name or firm" className="sm:col-span-2" />
          <SelectField
            control={form.control}
            name="kind"
            label="Role"
            required
            options={EQUITY_HOLDER_KINDS}
            disabled={kindLocked}
            description={kindLocked ? "Fixed once entries are recorded" : undefined}
          />
          <NumberField
            control={form.control}
            name="ownershipPercent"
            label="Ownership"
            suffix="%"
            step="any"
            placeholder="Where it applies"
            description="Leave empty if shares are not fixed"
          />
          {kind === "investor" ? (
            <SelectField control={form.control} name="instrument" label="Investment type" options={INVESTOR_INSTRUMENTS} clearable className="sm:col-span-2" />
          ) : null}
          <TextField control={form.control} name="email" label="Email" type="email" placeholder="name@example.com" />
          <TextField control={form.control} name="phone" label="Phone" type="tel" placeholder="+91" />
        </div>
        <TextareaField control={form.control} name="notes" label="Notes" placeholder="PAN, agreement terms, anything worth keeping" rows={3} />
      </FormSheetBody>
      <FormSheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-28">
          {pending ? <Spinner /> : null}
          {holder ? "Save changes" : kind === "investor" ? "Add investor" : "Add owner"}
        </Button>
      </FormSheetFooter>
    </form>
  );
}
