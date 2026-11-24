"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField, NumberField, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { formValidation } from "@/components/forms/form-options";
import { applyFieldErrors } from "@/lib/action-result";
import { toDateInput } from "@/lib/dates";
import { emitDataChanged } from "@/lib/events";
import type { BankAccountOption } from "@/server/lookups";
import { saveMaintenance } from "../actions";
import { EXPENSE_METHODS, maintenanceFormSchema, type MaintenanceFormInput, type MaintenanceFormValues } from "../schemas";
import type { MaintenanceEntryDTO } from "../types";

/** Adds or edits a service, repair or inspection, with the option to book its cost as an expense. */
export function MaintenanceDialog({
  assetId,
  entry,
  accounts,
  open,
  onOpenChange,
  onSaved,
}: {
  assetId: string;
  entry: MaintenanceEntryDTO | null;
  accounts: BankAccountOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const form = useForm<MaintenanceFormInput, unknown, MaintenanceFormValues>({
    resolver: zodResolver(maintenanceFormSchema),
    defaultValues: {
      assetId,
      entryId: entry?.id,
      date: entry ? toDateInput(entry.date) : toDateInput(new Date()),
      description: entry?.description ?? "",
      cost: entry?.cost ?? 0,
      vendor: entry?.vendor ?? "",
      nextDueDate: entry?.nextDueDate ? toDateInput(entry.nextDueDate) : "",
      recordExpense: false,
      paymentMethod: "bank_transfer",
      accountId: undefined,
    },
    ...formValidation,
  });
  const { control } = form;
  const recordExpense = useWatch({ control, name: "recordExpense" });
  const method = useWatch({ control, name: "paymentMethod" });
  const booked = Boolean(entry?.expense);

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveMaintenance(values);
      if (!result.ok) {
        applyFieldErrors(result, form.setError);
        toast.error(result.error);
        return;
      }
      toast.success(values.recordExpense && !booked ? "Maintenance saved and booked as an expense" : "Maintenance saved");
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
            <DialogTitle>{entry ? "Edit maintenance" : "Add maintenance"}</DialogTitle>
            <DialogDescription>A service, repair or inspection, and when the next one is due.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField control={control} name="date" label="Date" required />
            <DateField control={control} name="nextDueDate" label="Next due" />
            <TextareaField control={control} name="description" label="What was done" required rows={2} className="sm:col-span-2" />
            <NumberField
              control={control}
              name="cost"
              label="Cost"
              currency
              disabled={booked}
              description={booked ? "Booked as an expense: change the amount there" : undefined}
            />
            <TextField control={control} name="vendor" label="Done by" placeholder="Vendor or technician" />
          </div>
          {booked && entry?.expense ? (
            <p className="rounded-lg border bg-surface/40 px-3 py-2 text-xs text-muted-foreground">
              Booked as{" "}
              <Link href={`/finance/expenses?view=${entry.expense.id}`} className="font-mono font-medium text-foreground hover:underline">
                {entry.expense.number}
              </Link>
              .
            </p>
          ) : (
            <Controller
              control={control}
              name="recordExpense"
              render={({ field }) => (
                <label className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5">
                  <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} className="mt-0.5" />
                  <span className="text-sm">
                    <span className="block font-medium">Also record this cost as an expense</span>
                    <span className="block text-xs text-muted-foreground">Adds it to Expenses under Repairs and maintenance, so it is entered once.</span>
                  </span>
                </label>
              )}
            />
          )}
          {recordExpense && !booked ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField control={control} name="paymentMethod" label="Paid by" required options={EXPENSE_METHODS} />
              {method !== "credit" ? (
                <SelectField
                  control={control}
                  name="accountId"
                  label="Paid from"
                  clearable
                  placeholder="Default account for this method"
                  options={accounts.map((a) => ({ value: a.value, label: a.label, description: a.description }))}
                />
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
