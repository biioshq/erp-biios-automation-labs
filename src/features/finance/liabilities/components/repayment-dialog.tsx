"use client";

import { useMemo, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField, NumberField, SelectField, TextField } from "@/components/forms/fields";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, round2 } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { recordRepaymentAction } from "../actions";
import { REPAYMENT_METHODS, repaymentFormSchema, type RepaymentFormInput, type RepaymentFormValues } from "../schemas";

/**
 * Records a repayment: principal reduces the liability, interest is saved as an interest expense
 * (it then shows in Expenses and the P&L). `suggestion` is the next planned instalment, offered
 * as a starting point only.
 */
export function RepaymentDialog({
  liability,
  accounts,
  suggestion,
  open,
  onOpenChange,
  onDone,
}: {
  liability: { id: string; code: string; name: string; outstanding: number };
  accounts: BankAccountOption[];
  suggestion?: { principal: number; interest: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<RepaymentFormInput, unknown, RepaymentFormValues>({
    resolver: zodResolver(repaymentFormSchema),
    defaultValues: {
      liabilityId: liability.id,
      date: toDateInput(new Date()),
      principal: undefined,
      interest: undefined,
      paymentMethod: "bank_transfer",
      accountId: undefined,
      reference: "",
      note: "",
    },
  });
  const { control, setValue, setError } = form;
  const [principal, interest] = useWatch({ control, name: ["principal", "interest"] });
  const total = round2((Number(principal) || 0) + (Number(interest) || 0));
  const accountOptions = useMemo(() => accounts.map((a) => ({ value: a.value, label: a.description ? `${a.label} · ${a.description}` : a.label })), [accounts]);

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await recordRepaymentAction({ ...values, principal: values.principal ?? 0, interest: values.interest ?? 0 });
      if (!result.ok) {
        applyFieldErrors(result, setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.data.expenseId ? "Repayment recorded, interest saved as an expense" : "Repayment recorded");
      emitDataChanged();
      onOpenChange(false);
      form.reset();
      onDone?.();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Record a repayment</DialogTitle>
            <DialogDescription>
              {liability.code} {liability.name}. Still owed: <span className="tabular font-medium text-foreground">{formatCurrency(liability.outstanding, { exact: true })}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField control={control} name="principal" label="Principal" currency description="Reduces what is owed. Not an expense." />
            <NumberField control={control} name="interest" label="Interest" currency description="Saved as an interest expense." />
            {suggestion ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Next planned instalment: {formatCurrency(suggestion.principal, { exact: true })} principal and {formatCurrency(suggestion.interest, { exact: true })} interest.{" "}
                <button
                  type="button"
                  className="font-medium text-brand-ink hover:underline"
                  onClick={() => {
                    setValue("principal", Math.min(suggestion.principal, liability.outstanding), { shouldDirty: true });
                    setValue("interest", suggestion.interest, { shouldDirty: true });
                  }}
                >
                  Fill in
                </button>
              </p>
            ) : null}
            {liability.outstanding > 0 ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                <button type="button" className="font-medium text-brand-ink hover:underline" onClick={() => setValue("principal", liability.outstanding, { shouldDirty: true })}>
                  Repay the full {formatCurrency(liability.outstanding, { exact: true })}
                </button>
              </p>
            ) : null}
            <DateField control={control} name="date" label="Date paid" required />
            <SelectField control={control} name="paymentMethod" label="Method" required options={REPAYMENT_METHODS} />
            <SelectField control={control} name="accountId" label="Paid from" options={accountOptions} placeholder="Default account for the method" clearable className="sm:col-span-2" />
            <TextField control={control} name="reference" label="Reference" placeholder="UTR or cheque number" mono className="sm:col-span-2" />
            <TextField control={control} name="note" label="Note" className="sm:col-span-2" />
          </div>
          <p className="text-sm">
            Total paid: <span className="tabular font-semibold">{formatCurrency(total, { exact: true })}</span>
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Record repayment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
