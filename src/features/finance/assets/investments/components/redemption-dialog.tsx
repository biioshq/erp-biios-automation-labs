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
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { round2 } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { redeemInvestment } from "../actions";
import { redemptionFormSchema, type RedemptionFormInput, type RedemptionFormValues } from "../schemas";
import type { InvestmentDetail } from "../types";

/** Records a sale, maturity or withdrawal, showing the gain or loss against the cost as it is typed. */
export function RedemptionDialog({
  investment,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: {
  investment: InvestmentDetail;
  accounts: BankAccountOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const r = investment.redemption;
  const form = useForm<RedemptionFormInput, unknown, RedemptionFormValues>({
    resolver: zodResolver(redemptionFormSchema),
    defaultValues: {
      id: investment.id,
      date: r ? toDateInput(r.date) : toDateInput(new Date()),
      amount: r?.amount ?? investment.currentValue ?? investment.amount,
      accountId: r?.account?.id ?? investment.account?.id ?? undefined,
      notes: r?.notes ?? "",
    },
    ...formValidation,
  });
  const { control } = form;
  const amount = useWatch({ control, name: "amount" });
  const gain = round2((Number(amount) || 0) - investment.amount);

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await redeemInvestment(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(`${investment.name}: redemption recorded`);
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
            <DialogTitle>{r ? "Edit redemption" : "Record redemption"}</DialogTitle>
            <DialogDescription>The investment leaves the books on this date. Enter the total that came back, interest included.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name="date" label="Date" required />
            <NumberField control={control} name="amount" label="Amount received" currency required />
            <SelectField
              control={control}
              name="accountId"
              label="Received into"
              clearable
              placeholder="Default bank account"
              options={accounts.map((a) => ({ value: a.value, label: a.label, description: a.description }))}
              className="sm:col-span-2"
            />
            <TextareaField control={control} name="notes" label="Notes" placeholder="Matured, sold, withdrawn, buyer" rows={2} className="sm:col-span-2" />
          </div>
          <dl className="grid grid-cols-3 gap-2 rounded-lg border bg-surface/40 p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="mt-0.5 text-sm font-medium">
                <Money value={investment.amount} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Received</dt>
              <dd className="mt-0.5 text-sm font-medium">
                <Money value={Number(amount) || 0} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{gain >= 0 ? "Gain" : "Loss"}</dt>
              <dd className="mt-0.5 text-sm font-medium">
                <Money value={Math.abs(gain)} tone={gain >= 0 ? "positive" : "negative"} />
              </dd>
            </div>
          </dl>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Record redemption
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
