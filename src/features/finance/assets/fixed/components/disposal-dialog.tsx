"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField, NumberField, SelectField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { Money } from "@/components/shared/money";
import { applyFieldErrors } from "@/lib/action-result";
import { bookValue } from "@/lib/depreciation";
import { endOfDayIST, fromDateInput, toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { recordDisposal } from "../actions";
import { labelsFor } from "../labels";
import { disposalFormSchema, type DisposalFormInput, type DisposalFormValues } from "../schemas";
import type { AssetDetail } from "../types";

/** Records a sale, scrapping, write-off or loss, showing the book value and the gain or loss as it is typed. */
export function DisposalDialog({
  asset,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: AssetDetail;
  accounts: BankAccountOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = labelsFor(asset.kind);
  const [pending, startTransition] = useTransition();
  const form = useForm<DisposalFormInput, unknown, DisposalFormValues>({
    resolver: zodResolver(disposalFormSchema),
    defaultValues: {
      id: asset.id,
      date: asset.disposal ? toDateInput(asset.disposal.date) : toDateInput(new Date()),
      amount: asset.disposal?.amount ?? 0,
      accountId: asset.disposal?.account?.id ?? undefined,
      notes: asset.disposal?.notes ?? "",
    },
    ...formValidation,
  });
  const { control } = form;
  const date = useWatch({ control, name: "date" });
  const amount = useWatch({ control, name: "amount" });

  // The same function the books use, stopped on the disposal date.
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "");
  const disposalDate = valid ? fromDateInput(date!) : null;
  const atDate = disposalDate ? bookValue({ ...asset, disposal: { date: disposalDate } }, endOfDayIST(disposalDate)) : null;
  const gain = atDate ? round2((Number(amount) || 0) - atDate.bookValue) : null;

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await recordDisposal(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${asset.code} disposal recorded`);
      emitDataChanged();
      onOpenChange(false);
      onSaved();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{asset.disposal ? "Edit disposal" : "Record sale or disposal"}</DialogTitle>
            <DialogDescription>
              The asset leaves the books on this date and {labels.chargeLower} stops. Enter 0 when it was scrapped, lost or given away.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name="date" label="Date" required />
            <NumberField control={control} name="amount" label="Sale proceeds" currency required />
            <SelectField
              control={control}
              name="accountId"
              label="Received into"
              clearable
              placeholder="Default bank account"
              options={accounts.map((a) => ({ value: a.value, label: a.label, description: a.description }))}
              className="sm:col-span-2"
            />
            <TextareaField control={control} name="notes" label="Notes" placeholder="Buyer, reason, reference" rows={2} className="sm:col-span-2" />
          </div>
          {atDate && gain !== null ? (
            <dl className="grid grid-cols-3 gap-2 rounded-lg border bg-surface/40 p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">{labels.value} then</dt>
                <dd className="mt-0.5 text-sm font-medium">
                  <Money value={atDate.bookValue} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Proceeds</dt>
                <dd className="mt-0.5 text-sm font-medium">
                  <Money value={Number(amount) || 0} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{gain >= 0 ? "Gain on sale" : "Loss on disposal"}</dt>
                <dd className="mt-0.5 text-sm font-medium">
                  <Money value={Math.abs(gain)} tone={gain >= 0 ? "positive" : "negative"} />
                </dd>
              </div>
            </dl>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Record disposal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
