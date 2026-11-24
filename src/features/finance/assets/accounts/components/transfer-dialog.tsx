"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Info } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { fromDateInput, toDateInput } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { emitDataChanged } from "@/lib/events";
import { recordTransfer } from "../actions";
import { transferFormSchema, type TransferFormInput, type TransferFormValues } from "../schemas";
import type { AccountOption } from "../types";

/** Money moved between two of the company's own accounts: cash deposited, cash withdrawn, bank to bank. */
export function TransferDialog({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<TransferFormInput, unknown, TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      fromAccountId: accounts.find((a) => a.kind === "bank")?.value ?? accounts[0]?.value ?? "",
      toAccountId: accounts.find((a) => a.kind === "cash")?.value ?? accounts[1]?.value ?? "",
      amount: undefined as unknown as number,
      date: toDateInput(new Date()),
      reference: "",
      notes: "",
    },
    ...formValidation,
  });
  const options = accounts.map((a) => ({ value: a.value, label: a.label, description: a.description }));
  const [fromId, toId, date] = useWatch({ control: form.control, name: ["fromAccountId", "toAccountId", "date"] });
  // Allowed on purpose: an account opened later already counts this money in its opening balance.
  const openedLater = date ? accounts.filter((a) => (a.value === fromId || a.value === toId) && a.openingDate && date < a.openingDate) : [];

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await recordTransfer(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Transfer recorded");
      emitDataChanged();
      form.reset({ ...values, amount: undefined as unknown as number, reference: "", notes: "" });
      onOpenChange(false);
    }),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a transfer</DialogTitle>
          <DialogDescription>Money moved between your own accounts. It is neither income nor an expense.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField control={form.control} name="fromAccountId" label="From" required options={options} />
            <SelectField control={form.control} name="toAccountId" label="To" required options={options} />
            <NumberField control={form.control} name="amount" label="Amount" currency required />
            <DateField control={form.control} name="date" label="Date" required />
            <TextField control={form.control} name="reference" label="Reference" placeholder="UTR or slip number" mono className="sm:col-span-2" />
            <TextareaField control={form.control} name="notes" label="Notes" className="sm:col-span-2" />
          </div>
          {openedLater.length ? (
            <p className="flex gap-2 rounded-lg border bg-surface/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
              <span>
                {openedLater.map((a) => `${a.label} opens on ${formatDate(fromDateInput(a.openingDate!))}`).join(" and ")}.{" "}
                {openedLater.length > 1
                  ? "Both opening balances already include anything earlier, so this transfer changes neither balance."
                  : "Its opening balance already includes anything earlier, so this transfer only changes the other account."}{" "}
                If an opening balance does not include it, date the transfer on or after that opening date.
              </span>
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Record transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
