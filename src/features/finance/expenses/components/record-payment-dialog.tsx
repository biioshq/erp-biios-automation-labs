"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import type { BankAccountOption } from "@/server/lookups";
import { recordExpensePayment } from "../payment-actions";
import { PAYING_METHODS, expensePaymentSchema, type ExpensePaymentInput } from "../schemas";
import type { z } from "zod";

type Values = z.output<typeof expensePaymentSchema>;

/** Picker options for "Paid from": open accounts; empty means the default account for the method. */
export function accountChoices(accounts: BankAccountOption[]) {
  return accounts.map((a) => ({ value: a.value, label: a.label, description: a.description || undefined }));
}

/**
 * "Record payment" for an unpaid or part-paid expense: date, amount (starts at what is still owed),
 * method, account and reference. The server refuses more than is owed, so two people paying the
 * same bill at once cannot pay it twice.
 */
export function RecordPaymentButton({
  expense,
  accounts,
  variant = "default",
  size = "default",
  label = "Record payment",
  onRecorded,
}: {
  expense: { id: string; number: string; vendor: string; outstanding: number };
  accounts: BankAccountOption[];
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  label?: string;
  /** Called after a payment is saved (the page also refreshes through the live-change event). */
  onRecorded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaults = (): ExpensePaymentInput => ({
    id: expense.id,
    date: toDateInput(new Date()),
    amount: expense.outstanding > 0 ? expense.outstanding : (undefined as unknown as number),
    paymentMethod: "bank_transfer",
    accountId: undefined,
    reference: "",
    note: "",
  });
  const form = useForm<ExpensePaymentInput, unknown, Values>({
    resolver: zodResolver(expensePaymentSchema),
    defaultValues: defaults(),
    ...formValidation,
  });
  const { control } = form;
  const accountOptions = useMemo(() => accountChoices(accounts), [accounts]);
  const owed = formatCurrency(expense.outstanding, { exact: true });

  function show() {
    form.reset(defaults());
    setOpen(true);
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await recordExpensePayment(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      const left = result.data.outstanding;
      toast.success(left > 0 ? `Payment recorded. ${formatCurrency(left, { exact: true })} is still owed.` : `${expense.number} is now paid in full.`);
      emitDataChanged();
      setOpen(false);
      onRecorded?.();
    });
  });

  if (expense.outstanding <= 0) return null;

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={show}>
        <HandCoins /> {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={onSubmit} noValidate className="space-y-5">
            <DialogHeader>
              <DialogTitle>Record payment</DialogTitle>
              <DialogDescription>
                {expense.number} from {expense.vendor}. {owed} is still owed.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField control={control} name="amount" label="Amount paid" currency required description={`At most ${owed}`} />
              <DateField control={control} name="date" label="Paid on" required />
              <SelectField control={control} name="paymentMethod" label="Method" required options={PAYING_METHODS} />
              <SelectField
                control={control}
                name="accountId"
                label="Paid from"
                options={accountOptions}
                clearable
                placeholder={accountOptions.length ? "Default for the method" : "No accounts set up"}
                disabled={!accountOptions.length}
              />
              <TextField control={control} name="reference" label="Reference" placeholder="UTR, cheque no." className="sm:col-span-2" />
              <TextareaField control={control} name="note" label="Note" rows={2} className="sm:col-span-2" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Record payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
