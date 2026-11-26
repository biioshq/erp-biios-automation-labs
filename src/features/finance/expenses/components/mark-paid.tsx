"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Check, CheckCheck } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField, NumberField, SelectField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { useCan } from "@/components/current-user";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import { formatCurrency, formatDate, round2 } from "@/lib/format";
import type { PaymentMethod } from "@/lib/constants";
import type { BankAccountOption } from "@/server/lookups";
import { markExpensePaid, markExpensesPaid, undoExpensePayments } from "../payment-actions";
import type { PaymentDefaults } from "../payment-queries";
import { PAYING_METHODS, markExpensePaidSchema, markExpensesPaidSchema, type ExpensePaymentInput } from "../schemas";
import { accountChoices } from "./record-payment-dialog";

/** How long the toast offers Undo. The server allows the person who recorded it 15 minutes. */
const UNDO_TOAST_MS = 20_000;

type PaymentRef = { id: string; paymentId: string };

/** Takes back the payments Mark as paid just recorded, and says how it went. */
async function undo(payments: PaymentRef[], onUndone?: (ids: string[]) => void) {
  const result = await undoExpensePayments({ payments });
  if (!result.ok) {
    toast.error(result.error);
    return;
  }
  const back = payments.filter((p) => result.data.undone.includes(p.paymentId)).map((p) => p.id);
  if (result.data.failed.length) toast.warning(`${back.length} undone. ${result.data.failed[0].error}`);
  else toast.success(back.length === 1 ? "Payment undone. The bill is outstanding again." : `${back.length} payments undone. The bills are outstanding again.`);
  emitDataChanged();
  onUndone?.(back);
}

/** Keeps "Paid from" on each method's default account while the person has not picked one by hand. */
function useDefaultAccountFollowsMethod(
  method: PaymentMethod | undefined,
  defaults: PaymentDefaults,
  current: string | undefined,
  set: (accountId: string | undefined) => void,
) {
  const lastMethod = useRef(method);
  useEffect(() => {
    const previous = lastMethod.current;
    if (method === previous) return;
    lastMethod.current = method;
    const previousDefault = previous ? defaults.byMethod[previous] : undefined;
    // Only when the account shown is the previous method's default (or none): a hand-picked one stays.
    if (!current || current === previousDefault) set(method ? defaults.byMethod[method] : undefined);
  }, [method, current, defaults, set]);
}

type Values = z.output<typeof markExpensePaidSchema>;

/**
 * The tick on an outstanding bill: a small confirm prefilled with today, the default account and
 * method, and the full amount owed, so one click pays it. The toast then offers Undo for a while.
 */
export function MarkPaidButton({
  expense,
  accounts,
  defaults,
  onPaid,
  onUndone,
  compact = false,
}: {
  /** `paymentMethod`: the method the bill was saved with. When money is paid that way (a recurring bill's planned method), the confirm starts with it. */
  expense: { id: string; number: string; vendor: string; outstanding: number; paymentMethod?: string };
  accounts: BankAccountOption[];
  defaults: PaymentDefaults;
  /** Called with the expense id once it is paid (the row can leave the list straight away). */
  onPaid?: (id: string) => void;
  onUndone?: (ids: string[]) => void;
  /** Icon only, for tight rows. */
  compact?: boolean;
}) {
  const canPay = useCan("finance.payments:create");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const planned = PAYING_METHODS.find((m) => m.value === expense.paymentMethod)?.value as PaymentMethod | undefined;
  const initial = (): ExpensePaymentInput => ({
    id: expense.id,
    date: toDateInput(new Date()),
    amount: expense.outstanding,
    paymentMethod: planned ?? defaults.paymentMethod,
    accountId: (planned && planned !== defaults.paymentMethod ? defaults.byMethod[planned] : defaults.accountId) ?? undefined,
    reference: "",
    note: "",
  });
  const form = useForm<ExpensePaymentInput, unknown, Values>({ resolver: zodResolver(markExpensePaidSchema), defaultValues: initial(), ...formValidation });
  const { control, setValue } = form;
  const [method, accountId] = useWatch({ control, name: ["paymentMethod", "accountId"] });
  const setAccount = useCallback((v: string | undefined) => setValue("accountId", v), [setValue]);
  useDefaultAccountFollowsMethod(method as PaymentMethod | undefined, defaults, accountId, setAccount);
  const accountOptions = useMemo(() => accountChoices(accounts), [accounts]);
  const owed = formatCurrency(expense.outstanding, { exact: true });

  if (!canPay || expense.outstanding <= 0) return null;

  function show() {
    form.reset(initial());
    setOpen(true);
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await markExpensePaid(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      setOpen(false);
      const left = result.data.outstanding;
      // A part payment leaves the bill owing: the refresh moves it to its new tab instead.
      if (left <= 0) onPaid?.(expense.id);
      emitDataChanged();
      const ref = { id: expense.id, paymentId: result.data.paymentId };
      toast.success(left > 0 ? `${expense.number}: payment recorded, ${formatCurrency(left, { exact: true })} still owed.` : `${expense.number} marked as paid on ${formatDate(values.date)}.`, {
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => void undo([ref], onUndone) },
      });
    });
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon-sm" : "sm"}
        onClick={show}
        aria-label={`Mark ${expense.number} as paid`}
        title="Mark as paid"
        className="text-success hover:text-success"
      >
        <Check />
        {compact ? null : "Mark as paid"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>Mark as paid</DialogTitle>
              <DialogDescription>
                {expense.vendor}, {expense.number}. {owed} owed. The expense keeps its own date.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField control={control} name="date" label="Paid on" required />
              <NumberField control={control} name="amount" label="Amount" currency required description={`At most ${owed}`} />
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
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} autoFocus>
                {pending ? <Spinner /> : <Check />}
                Confirm paid
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type BulkValues = z.output<typeof markExpensesPaidSchema>;
type BulkInput = z.input<typeof markExpensesPaidSchema>;

/**
 * Mark selected as paid: one day and one account for all of them, each paid what it still owes.
 * Bills that changed meanwhile are reported and stay in the list.
 */
export function BulkMarkPaidButton({
  selected,
  accounts,
  defaults,
  onPaid,
  onUndone,
}: {
  selected: { id: string; number: string; outstanding: number }[];
  accounts: BankAccountOption[];
  defaults: PaymentDefaults;
  onPaid?: (ids: string[]) => void;
  onUndone?: (ids: string[]) => void;
}) {
  const canPay = useCan("finance.payments:create");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const initial = (): BulkInput => ({
    ids: selected.map((s) => s.id),
    expected: selected.map((s) => ({ id: s.id, outstanding: s.outstanding })),
    date: toDateInput(new Date()),
    paymentMethod: defaults.paymentMethod,
    accountId: defaults.accountId ?? undefined,
    reference: "",
    note: "",
  });
  const form = useForm<BulkInput, unknown, BulkValues>({ resolver: zodResolver(markExpensesPaidSchema), defaultValues: initial(), ...formValidation });
  const { control, setValue } = form;
  const [method, accountId] = useWatch({ control, name: ["paymentMethod", "accountId"] });
  const setAccount = useCallback((v: string | undefined) => setValue("accountId", v), [setValue]);
  useDefaultAccountFollowsMethod(method as PaymentMethod | undefined, defaults, accountId, setAccount);
  const accountOptions = useMemo(() => accountChoices(accounts), [accounts]);
  const total = round2(selected.reduce((s, r) => s + r.outstanding, 0));

  if (!canPay || !selected.length) return null;

  function show() {
    form.reset(initial());
    setOpen(true);
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await markExpensesPaid(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      setOpen(false);
      const { paid, failed } = result.data;
      if (paid.length) {
        onPaid?.(paid.map((p) => p.id));
        emitDataChanged();
        const refs = paid.map((p) => ({ id: p.id, paymentId: p.paymentId }));
        const sum = formatCurrency(round2(paid.reduce((s, p) => s + p.amount, 0)), { exact: true });
        toast.success(`${paid.length} ${paid.length === 1 ? "bill" : "bills"} marked as paid (${sum}) on ${formatDate(values.date)}.`, {
          duration: UNDO_TOAST_MS,
          action: { label: "Undo", onClick: () => void undo(refs, onUndone) },
        });
      }
      if (failed.length) {
        const name = selected.find((s) => s.id === failed[0].id)?.number ?? "One bill";
        toast.error(`${failed.length} not marked: ${name}: ${failed[0].error}`);
      }
    });
  });

  return (
    <>
      <Button type="button" size="sm" onClick={show} className="h-8 max-md:h-10">
        <CheckCheck /> Mark selected as paid
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>Mark {selected.length === 1 ? "1 bill" : `${selected.length} bills`} as paid</DialogTitle>
              <DialogDescription>
                Each is paid what it still owes, {formatCurrency(total, { exact: true })} in all. The expenses keep their own dates.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField control={control} name="date" label="Paid on" required className="sm:col-span-2" />
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
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} autoFocus>
                {pending ? <Spinner /> : <CheckCheck />}
                Confirm paid
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
